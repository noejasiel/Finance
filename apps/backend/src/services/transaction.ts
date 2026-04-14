import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import type { ParseResult } from "@finance/shared";
import { CONFIDENCE_THRESHOLD, ALERT_THRESHOLDS } from "@finance/shared";

const CATEGORY_LABELS: Record<string, string> = {
  food: "🍔 Comida",
  transport: "🚗 Transporte",
  entertainment: "🎬 Entretenimiento",
  health: "🏥 Salud",
  shopping: "🛍️ Compras",
  services: "🔧 Servicios",
  housing: "🏠 Hogar",
  education: "📚 Educación",
  travel: "✈️ Viajes",
  salary: "💼 Salario",
  freelance: "💻 Freelance",
  gift: "🎁 Regalos",
  investment: "📈 Inversión",
  other: "📦 Otros",
};

function formatMoney(minorUnits: number): string {
  return (minorUnits / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Create transaction ────────────────────────────────────────────

export async function createTransaction(userId: string, parsed: ParseResult) {
  const tx = await prisma.transaction.create({
    data: {
      userId,
      amountMinor: parsed.amount_minor!,
      currency: parsed.currency,
      transactionType: parsed.transaction_type!,
      category: parsed.category || "other",
      description: parsed.description,
      occurredAt: parsed.occurred_at ? new Date(parsed.occurred_at) : new Date(),
    },
  });

  logger.info(
    { txId: tx.id, amount: parsed.amount_minor, type: parsed.transaction_type },
    "Transaction created",
  );

  return tx;
}

/**
 * Check if the new transaction triggers any category limit alerts.
 * Returns alert message or null.
 */
export async function checkCategoryAlerts(userId: string, category: string): Promise<string | null> {
  const rules = await prisma.alertRule.findMany({
    where: {
      userId,
      type: "category_limit",
      category,
      enabled: true,
    },
  });

  if (rules.length === 0) return null;

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const spent = await prisma.transaction.aggregate({
    where: {
      userId,
      category,
      transactionType: "expense",
      deletedAt: null,
      occurredAt: { gte: startOfMonth, lt: endOfMonth },
    },
    _sum: { amountMinor: true },
  });

  const totalSpent = spent._sum.amountMinor || 0;

  for (const rule of rules) {
    if (!rule.thresholdMinor) continue;
    const ratio = totalSpent / rule.thresholdMinor;

    for (const threshold of [...ALERT_THRESHOLDS].reverse()) {
      if (ratio >= threshold) {
        const pct = Math.round(threshold * 100);
        const icon = threshold >= 1.0 ? "🔴" : "⚠️";
        const label = CATEGORY_LABELS[category] || category;
        return [
          "",
          `${icon} *Alerta: ${label}*`,
          `Llevas $${formatMoney(totalSpent)} de $${formatMoney(rule.thresholdMinor)} (${pct}%)`,
        ].join("\n");
      }
    }
  }

  return null;
}

/**
 * Build the WhatsApp confirmation message after saving a transaction.
 */
export function buildTransactionConfirmation(parsed: ParseResult): string {
  const isIncome = parsed.transaction_type === "income";
  const icon = isIncome ? "💰" : "💸";
  const typeLabel = isIncome ? "Ingreso" : "Gasto";
  const category = CATEGORY_LABELS[parsed.category || "other"] || parsed.category;

  const lines = [
    `${icon} *${typeLabel} registrado*`,
    "",
    `  Monto: $${formatMoney(parsed.amount_minor!)} ${parsed.currency}`,
    `  Categoría: ${category}`,
  ];

  if (parsed.description) {
    lines.push(`  Descripción: ${parsed.description}`);
  }

  lines.push("", '_Escribe "borra el último" para deshacer._');

  return lines.join("\n");
}

/**
 * Build a message asking the user to confirm an ambiguous parse.
 */
export function buildConfirmationRequest(parsed: ParseResult): string {
  const isIncome = parsed.transaction_type === "income";
  const typeLabel = isIncome ? "ingreso" : "gasto";

  const lines = [
    "🤔 *No estoy seguro, ¿es esto correcto?*",
    "",
    `  Tipo: ${typeLabel}`,
    `  Monto: $${formatMoney(parsed.amount_minor!)} ${parsed.currency}`,
    `  Categoría: ${CATEGORY_LABELS[parsed.category || "other"] || parsed.category}`,
  ];

  if (parsed.description) {
    lines.push(`  Descripción: ${parsed.description}`);
  }

  lines.push("", "Responde *sí* para guardar o *no* para cancelar.");

  return lines.join("\n");
}

// ── Delete last transaction ───────────────────────────────────────

export async function deleteLastTransaction(userId: string): Promise<string> {
  const last = await prisma.transaction.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!last) {
    return "No tienes movimientos para borrar.";
  }

  await prisma.transaction.update({
    where: { id: last.id },
    data: { deletedAt: new Date() },
  });

  const icon = last.transactionType === "income" ? "💰" : "💸";
  const typeLabel = last.transactionType === "income" ? "ingreso" : "gasto";

  return [
    `🗑️ *${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} eliminado*`,
    "",
    `  ${icon} $${formatMoney(last.amountMinor)} — ${last.description || last.category}`,
  ].join("\n");
}

// ── Correct last transaction ──────────────────────────────────────

export async function correctLastTransaction(
  userId: string,
  field: string,
  newValue: string,
): Promise<string> {
  const last = await prisma.transaction.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!last) {
    return "No tienes movimientos para corregir.";
  }

  const updateData: Record<string, unknown> = {};

  switch (field) {
    case "transaction_type":
      updateData.transactionType = newValue;
      break;
    case "amount":
    case "amount_minor": {
      const amount = parseInt(newValue, 10);
      if (!isNaN(amount)) updateData.amountMinor = amount;
      break;
    }
    case "category":
      updateData.category = newValue;
      break;
    case "description":
      updateData.description = newValue;
      break;
    default:
      return `No sé cómo corregir el campo "${field}".`;
  }

  const updated = await prisma.transaction.update({
    where: { id: last.id },
    data: updateData,
  });

  const icon = updated.transactionType === "income" ? "💰" : "💸";
  const typeLabel = updated.transactionType === "income" ? "ingreso" : "gasto";

  return [
    "✏️ *Movimiento corregido*",
    "",
    `  ${icon} ${typeLabel}: $${formatMoney(updated.amountMinor)} — ${updated.description || updated.category}`,
  ].join("\n");
}

/**
 * Check if a parse result needs confirmation or can be saved directly.
 */
export function needsConfirmation(parsed: ParseResult): boolean {
  return parsed.needs_confirmation || parsed.confidence < CONFIDENCE_THRESHOLD;
}

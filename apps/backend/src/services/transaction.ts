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

    // Use specific thresholds (e.g. 0.8 to warn at 80%)
    for (const threshold of [...ALERT_THRESHOLDS].reverse()) {
      if (ratio >= threshold) {
        const pct = Math.round(ratio * 100);
        const icon = ratio >= 1.0 ? "🔴" : "⚠️";
        const label = CATEGORY_LABELS[category] || category;
        return [
          "",
          `${icon} *Alerta de Presupuesto: ${label}*`,
          `Llevas $${formatMoney(totalSpent)} de los $${formatMoney(rule.thresholdMinor)} que tenías planeado (${pct}%)`,
        ].join("\n");
      }
    }
  }

  return null;
}

/**
 * Build the WhatsApp confirmation message after saving a transaction.
 * Uses consistent format per plan: icon, separator, amount, category + description, monthly total.
 */
export function buildTransactionConfirmation(parsed: ParseResult, monthlyTotal?: number): string {
  const isIncome = parsed.transaction_type === "income";
  const icon = isIncome ? "💰" : "💸";
  const typeLabel = isIncome ? "Ingreso registrado" : "Gasto registrado";
  const catLabel = CATEGORY_LABELS[parsed.category || "other"] || parsed.category;
  const desc = parsed.description ? `  ·  ${parsed.description}` : "";

  const lines = [
    `${icon} ${typeLabel}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `  $${formatMoney(parsed.amount_minor!)} ${parsed.currency}`,
    `  ${catLabel}${desc}`,
  ];

  if (monthlyTotal !== undefined) {
    const totalLabel = isIncome ? "ingresos" : "gastos";
    lines.push("", `📊 Este mes: $${formatMoney(monthlyTotal)} en ${totalLabel}`);
  }

  lines.push("", '_Escribe "borra el último" para deshacer._');

  return lines.join("\n");
}

/**
 * Get the month-to-date total for a user by transaction type.
 */
export async function getMonthlyTotal(userId: string, transactionType: string): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const result = await prisma.transaction.aggregate({
    where: {
      userId,
      transactionType,
      deletedAt: null,
      occurredAt: { gte: startOfMonth, lt: endOfMonth },
    },
    _sum: { amountMinor: true },
  });

  return result._sum.amountMinor || 0;
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

// ── Reset transactions by timeframe ───────────────────────────────

export type ResetTimeframe = "day" | "week" | "15days" | "month" | "all";

const TIMEFRAME_LABELS: Record<ResetTimeframe, string> = {
  day: "solo los registrados el día de hoy",
  week: "los de esta semana en curso",
  "15days": "los registrados en los últimos 15 días",
  month: "todos los del mes actual completo",
  all: "tu historial completo desde el primer día",
};

function getTimeframeDate(timeframe: ResetTimeframe): Date | null {
  const now = new Date();
  switch (timeframe) {
    case "day":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    case "week": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    }
    case "15days": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 15);
      return d;
    }
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case "all":
      return null; // no lower bound
  }
}

/**
 * Soft-delete all transactions for a user within a timeframe OR the last N records.
 * Returns the count of affected records.
 */
export async function resetTransactions(
  userId: string,
  timeframe: ResetTimeframe,
  count?: number | null
): Promise<number> {
  // Count-based: delete the last N transactions by id
  if (count && count > 0) {
    const txs = await prisma.transaction.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: count,
      select: { id: true },
    });

    if (txs.length === 0) return 0;

    const result = await prisma.transaction.updateMany({
      where: { id: { in: txs.map(t => t.id) } },
      data: { deletedAt: new Date() },
    });

    logger.info({ userId, count, deleted: result.count }, "Transactions reset by count");
    return result.count;
  }

  // Timeframe-based: delete all within the period
  const since = getTimeframeDate(timeframe);

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
  };

  if (since) {
    where.occurredAt = { gte: since };
  }

  const result = await prisma.transaction.updateMany({
    where,
    data: { deletedAt: new Date() },
  });

  logger.info({ userId, timeframe, count: result.count }, "Transactions reset");
  return result.count;
}

/**
 * Fetch a preview of transactions that will be deleted.
 */
export async function getTransactionsForResetPreview(
  userId: string,
  timeframe: ResetTimeframe,
  count?: number | null
): Promise<{ list: string[]; count: number }> {
  // Count-based preview
  if (count && count > 0) {
    const txs = await prisma.transaction.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: count,
    });

    const list = txs.map(tx => {
      const d = new Date(tx.occurredAt);
      const dateStr = d.toLocaleDateString("es-MX", { day: '2-digit', month: 'short' });
      const catLabel = CATEGORY_LABELS[tx.category] || tx.category;
      const name = tx.description ? tx.description : catLabel;
      const isIncome = tx.transactionType === "income";
      const sign = isIncome ? "+" : "-";
      return `• ${dateStr} - ${name} - ${sign}$${formatMoney(tx.amountMinor)}`;
    });

    return { list, count: txs.length };
  }

  // Timeframe-based preview
  const since = getTimeframeDate(timeframe);

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
  };

  if (since) {
    where.occurredAt = { gte: since };
  }

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: 15,
  });

  const totalCount = await prisma.transaction.count({ where });

  const list = txs.map(tx => {
    const d = new Date(tx.occurredAt);
    const dateStr = d.toLocaleDateString("es-MX", { day: '2-digit', month: 'short' });
    const catLabel = CATEGORY_LABELS[tx.category] || tx.category;
    const name = tx.description ? tx.description : catLabel;
    const isIncome = tx.transactionType === "income";
    const sign = isIncome ? "+" : "-";
    return `• ${dateStr} - ${name} - ${sign}$${formatMoney(tx.amountMinor)}`;
  });

  return { list, count: totalCount };
}

/**
 * Build the confirmation prompt before executing a reset, now showing data preview.
 */
export function buildResetConfirmation(
  timeframe: ResetTimeframe,
  previewList: string[],
  totalCount: number,
  count?: number | null
): string {
  if (totalCount === 0) {
    return `📭 No tienes movimientos para borrar.`;
  }

  const actionLabel = count && count > 0
    ? `los últimos *${count}* movimiento${count > 1 ? "s" : ""} (${totalCount} encontrado${totalCount > 1 ? "s" : ""})`
    : `${TIMEFRAME_LABELS[timeframe]} (${totalCount} en total)`;

  const lines = [
    "⚠️ *¿Estás seguro?*",
    "",
    `Esta acción eliminará ${actionLabel}.`,
    "",
    ...previewList,
  ];

  if (totalCount > previewList.length) {
    lines.push(`_... y ${totalCount - previewList.length} más_`);
  }

  lines.push("", "Responde *sí* para confirmar o *no* para cancelar.");
  return lines.join("\n");
}

// ── Smart Budgets ─────────────────────────────────────────────────

export async function setBudget(userId: string, category: string, amountMinor: number): Promise<string> {
  await prisma.alertRule.upsert({
    where: {
      userId_type_category: {
        userId,
        type: "category_limit",
        category
      }
    },
    update: {
      thresholdMinor: amountMinor,
      enabled: true,
    },
    create: {
      userId,
      type: "category_limit",
      category,
      thresholdMinor: amountMinor,
      enabled: true,
    }
  });

  const label = CATEGORY_LABELS[category] || category;
  return `✅ *Presupuesto guardado*\n\nTe avisaré cuando tus gastos mensuales en ${label} superen el 80% de $${formatMoney(amountMinor)}.`;
}

export function buildBudgetConfirmationRequest(amountMinor: number, category: string): string {
  const label = CATEGORY_LABELS[category] || category;
  return [
    `¿Quieres establecer un presupuesto mensual de *$${formatMoney(amountMinor)}* para *${label}*?`,
    "",
    "Te avisaré automáticamente cuando estés por llegar al límite.",
    "Responde *sí* para confirmarlo."
  ].join("\n");
}

/**
 * Build the result message after a reset is executed.
 */
export function buildResetResult(count: number, timeframe: ResetTimeframe): string {
  const label = TIMEFRAME_LABELS[timeframe];
  if (count === 0) {
    return `📭 No había movimientos ${label} para borrar.`;
  }
  return [
    "🧹 *Cuenta limpia*",
    "",
    `Se eliminaron *${count}* movimiento${count > 1 ? "s" : ""} ${label}.`,
    "",
    "Tu dashboard ya refleja los cambios. ¡Empezamos de cero! 💪",
  ].join("\n");
}

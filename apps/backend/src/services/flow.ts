import { prisma } from "../lib/prisma.js";
import type { ParseResult } from "@finance/shared";

// ── Keyword detection ─────────────────────────────────────────────

const GREETING_PATTERNS = /^(hola|hey|hi|buenas|buenos?\s*d[ií]as?|buenas?\s*tardes?|buenas?\s*noches?|qu[eé]\s*onda|qué\s*tal|ola|saludos?|sup)\b/i;
const HELP_PATTERNS = /^(ayuda|help|instrucciones|c[oó]mo\s*(funciona|te?\s*uso|va)|qu[eé]\s*(puedo|haces|sabes)|men[uú]|comandos|opciones|\?)\b/i;
const SUMMARY_PATTERNS = /^(resumen|resume|mi\s*resumen|cu[aá]nto\s*(llevo|gast[eé]|gaste)|balance|estado)\b/i;
const CONFIRM_YES = /^(s[ií]|si|sip|sep|ok|sale|va|arre|nel.*mentira|confirmed?|yes|y|👍|✅)\s*$/i;
const CONFIRM_NO = /^(no|nel|nop|nope|cancel[ao]?|olvida|ya\s*no|n|👎|❌)\s*$/i;

// Income shortcut: "+300 nómina", "mas 200 pagina", "más 500 freelance", "ms 200"
const INCOME_SHORTCUT = /^(?:\+|m[aá]+s?)\s*(\d[\d,.]*)\s*(.*)?$/i;

export type FlowIntent =
  | "greeting"
  | "help"
  | "summary_request"
  | "income_shortcut"
  | "confirm_yes"
  | "confirm_no"
  | "transaction"
  | "unknown";

/**
 * Detect basic intent from the message text (no AI needed).
 * @param hasPendingConfirmation - true if the last bot message was a confirmation request
 */
export function detectBasicIntent(text: string, hasPendingConfirmation = false): FlowIntent {
  const trimmed = text.trim();

  // Check yes/no first when there's a pending confirmation
  if (hasPendingConfirmation) {
    if (CONFIRM_YES.test(trimmed)) return "confirm_yes";
    if (CONFIRM_NO.test(trimmed)) return "confirm_no";
  }

  if (GREETING_PATTERNS.test(trimmed)) return "greeting";
  if (HELP_PATTERNS.test(trimmed)) return "help";
  if (SUMMARY_PATTERNS.test(trimmed)) return "summary_request";
  if (INCOME_SHORTCUT.test(trimmed)) return "income_shortcut";

  // Everything else goes to AI parser
  return "transaction";
}

/**
 * Get the pending confirmation parse result from the last bot message, if any.
 */
export async function getPendingConfirmation(userId: string): Promise<ParseResult | null> {
  const lastBotMessage = await prisma.conversationMessage.findFirst({
    where: { userId, role: "assistant" },
    orderBy: { createdAt: "desc" },
  });

  if (!lastBotMessage?.parseResult) return null;

  // Check if it's recent (within 5 minutes)
  const age = Date.now() - new Date(lastBotMessage.createdAt).getTime();
  if (age > 5 * 60_000) return null;

  try {
    return lastBotMessage.parseResult as unknown as ParseResult;
  } catch {
    return null;
  }
}

/**
 * Parse an income shortcut message like "+300 nómina" or "mas 200 pagina".
 * Returns a ParseResult-compatible object without needing AI.
 */
export function parseIncomeShortcut(text: string): ParseResult | null {
  const match = text.trim().match(INCOME_SHORTCUT);
  if (!match) return null;

  const rawAmount = match[1].replace(/,/g, "");
  const amount = Math.round(parseFloat(rawAmount) * 100);
  if (isNaN(amount) || amount <= 0) return null;

  const description = match[2]?.trim() || null;

  return {
    intent: "log_transaction",
    confidence: 1,
    amount_minor: amount,
    currency: "MXN",
    transaction_type: "income",
    category: guessIncomeCategory(description),
    description,
    occurred_at: null,
    needs_confirmation: false,
    correction: null,
  };
}

function guessIncomeCategory(desc: string | null): "salary" | "freelance" | "other" {
  if (!desc) return "other";
  const lower = desc.toLowerCase();
  if (/n[oó]mina|sueldo|salario|quincena/.test(lower)) return "salary";
  if (/freelance?|proyecto|cliente|pago|pagina|chamba|jale/.test(lower)) return "freelance";
  return "other";
}

// ── Response builders ─────────────────────────────────────────────

export function buildGreeting(isNewUser: boolean): string {
  if (isNewUser) {
    return [
      "👋 ¡Hola! Soy tu asistente de finanzas personales.",
      "",
      "Puedo ayudarte a llevar control de tus gastos e ingresos directamente desde WhatsApp.",
      "",
      "Escribe *ayuda* para ver todo lo que puedo hacer.",
    ].join("\n");
  }

  return [
    "👋 ¡Hola de nuevo!",
    "",
    "¿En qué te ayudo? Puedes registrar un gasto, pedir tu resumen o escribir *ayuda*.",
  ].join("\n");
}

export function buildHelp(): string {
  return [
    "📋 *Esto es lo que puedo hacer:*",
    "",
    "💰 *Registrar gastos*",
    "  Escribe el gasto de forma natural:",
    '  • "café 45"',
    '  • "uber al trabajo 89"',
    '  • "super 1200"',
    '  • "gasté 350 en gasolina"',
    "",
    "📈 *Registrar ingresos*",
    '  • "+500 freelance"',
    '  • "mas 200 pagina"',
    '  • "me pagaron 15000"',
    '  • "cobré 8000"',
    "",
    "🔄 *Corregir el último registro*",
    '  • "borra el último"',
    '  • "eso fue un ingreso"',
    '  • "en realidad fueron 500"',
    "",
    "📊 *Ver resumen del mes*",
    '  • "resumen"',
    '  • "cuánto llevo"',
    '  • "balance"',
    "",
    "💡 *Tips:*",
    "  • No necesitas ser exacto — si no estás seguro del monto te preguntaré.",
    "  • Detecto la categoría automáticamente (comida, transporte, etc).",
    "  • También puedes ver y editar todo desde la web.",
  ].join("\n");
}

export async function buildMonthlySummary(userId: string): Promise<string> {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      occurredAt: { gte: startOfMonth, lt: endOfMonth },
    },
  });

  if (transactions.length === 0) {
    return [
      "📊 *Resumen del mes*",
      "",
      "No tienes movimientos registrados este mes.",
      "",
      'Empieza registrando un gasto, por ejemplo: "café 45"',
    ].join("\n");
  }

  const expenses = transactions.filter((t) => t.transactionType === "expense");
  const income = transactions.filter((t) => t.transactionType === "income");

  const totalExpenses = expenses.reduce((sum, t) => sum + t.amountMinor, 0);
  const totalIncome = income.reduce((sum, t) => sum + t.amountMinor, 0);
  const balance = totalIncome - totalExpenses;

  // Group expenses by category
  const byCategory = new Map<string, number>();
  for (const tx of expenses) {
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + tx.amountMinor);
  }

  const categoryLines = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, total]) => `  • ${categoryLabel(cat)}: $${formatMoney(total)}`);

  const monthName = now.toLocaleString("es-MX", { month: "long" });

  // Last 5 movements
  const recentTxs = [...transactions]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 5)
    .map((t) => {
      const icon = t.transactionType === "income" ? "💰" : "💸";
      const sign = t.transactionType === "income" ? "+" : "-";
      const desc = t.description || t.category;
      return `  ${icon} ${sign}$${formatMoney(t.amountMinor)} — ${desc}`;
    });

  const lines = [
    `📊 *Resumen de ${monthName}*`,
    "",
    `💸 Gastos: $${formatMoney(totalExpenses)}`,
    `💰 Ingresos: $${formatMoney(totalIncome)}`,
    `${balance >= 0 ? "✅" : "🔴"} Balance: $${formatMoney(balance)}`,
    "",
    `📝 ${transactions.length} movimientos`,
  ];

  if (categoryLines.length > 0) {
    lines.push("", "📂 *Top categorías (gastos):*", ...categoryLines);
  }

  if (recentTxs.length > 0) {
    lines.push("", "🕐 *Últimos movimientos:*", ...recentTxs);
  }

  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────

function formatMoney(minorUnits: number): string {
  const abs = Math.abs(minorUnits);
  const formatted = (abs / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return minorUnits < 0 ? `-${formatted}` : formatted;
}

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

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category;
}

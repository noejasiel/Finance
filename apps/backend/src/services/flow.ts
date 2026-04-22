import { prisma } from "../lib/prisma.js";
import type { ParseResult } from "@finance/shared";

// Greetings: hola, hey, buenas, qué onda, emojis
const GREETING_PATTERNS = /^(hola|hey|hi|buenas|buenos?\s*d[ií]as?|buenas?\s*tardes?|buenas?\s*noches?|qu[eé]\s*onda|qu[eé]\s*tal|que\s*tal|ola|saludos?|sup|wey|ey|epa|épale|\ud83d\udc4b|\ud83d\ude0a|\ud83d\ude4c)\b/i;

// Help: /ayuda, ayuda, menú, cómo funciona, qué puedes hacer
const HELP_PATTERNS = /^\/?(?:ayuda|help|instrucciones|men[uú]|comandos|opciones)\b|(?:c[oó]mo\s+(?:funciona|te?\s*uso|te?\s*utilizo|te?\s*manejas?)|qu[eé]\s+(?:puedes?\s+hacer|haces?|sabes?|comandos?|puedo\s+hacer)|\?$)/i;

// Summary: detects natural queries about spending/summary/balance — NO ^ anchor
const SUMMARY_PATTERNS = /\b(resumen|resume|balance|estado\s+de\s+cuenta)\b|\bcu[áa]nto\s+(?:gast[eé]|llevo|tengo|he\s+gastado|gaste|ingres[eé])\b|\bqu[eé]\s+(?:gast[eé]|gastaste|compr[eé]|compré?|ingres[eé]|gastos\s+(?:hice|tuve|tengo))\b|\bmis\s+(?:gastos?|ingresos?|movimientos?)\b|\bc[oó]mo\s+(?:voy|estoy|va)\b|\bqué\s+(?:gast[eé]|compr[eé])\b/i;

// Reset: borra, elimina, olvida, limpia, resetea, desde cero
const RESET_PATTERNS = /\b(olvida(?:r)?|borra(?:r)?|elimina(?:r)?|resetea(?:r)?|limpia(?:r)?|reinicia(?:r)?|reset)\b|\bempec[eé]mos\s+de\s+(0|cero)\b|\bdesde\s+(0|cero)\b|\bcuenta\s+nueva\b|\bvolver\s+a\s+empezar\b|\bquiero\s+empezar\s+de\s+nuevo\b|\bborra(?:r)?\s+(?:todo|mis|el|la|los|esta|lo\s+de)\b|\blimpia(?:r)?\s+(?:todo|mis|el|la)\b/i;

const CONFIRM_YES = /^(s[ií]|si|sip|sep|ok|sale|va|arre|nel.*mentira|confirmed?|yes|y|\ud83d\udc4d|\u2705)\s*$/i;
const CONFIRM_NO = /^(no|nel|nop|nope|cancel[ao]?|ya\s*no|n|\ud83d\udc4e|\u274c)\s*$/i;

// Income shortcut: "+300 nómina", "mas 200 pagina", "más 500 freelance", "ms 200"
const INCOME_SHORTCUT = /^(?:\+|m[aá]+s?)\s*(\d[\d,.]*)\s*(.*)?$/i;

export type FlowIntent =
  | "greeting"
  | "help"
  | "summary_request"
  | "income_shortcut"
  | "confirm_yes"
  | "confirm_no"
  | "reset_request"
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
  if (RESET_PATTERNS.test(trimmed)) return "reset_request";

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
    reset_timeframe: null,
    analyze_timeframe: null,
    reset_count: null,
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
    "📋 *Guía de Comandos*",
    "",
    "💰 *Registrar Movimientos*",
    "  • Gasto: \"comida 150\", \"uber 85\", \"cine 200\"",
    "  • Ingreso: \"+500 freelance\", \"mas 2000 nomina\"",
    "",
    "🔄 *Correcciones*",
    "  • \"borra el último\" (deshace el registro anterior)",
    "  • \"en realidad fueron 100\" (corrige el monto)",
    "  • \"eso fue un ingreso\" (corrige el tipo)",
    "",
    "📊 *Consultas*",
    "  • \"resumen\": Estado de cuenta del mes actual",
    "  • \"balance\": Lo que te queda (ingresos - gastos)",
    "",
    "🎯 *Presupuestos (Smart Budgets)*",
    "  • \"mi presupuesto de comida es 5000\"",
    "  • \"aviso de 2000 en entretenimiento\"",
    "  _Te avisaré automáticamente al llegar al 80%_",
    "",
    "🧹 *Limpieza (Reset)*",
    "  • \"olvida lo de hoy\"",
    "  • \"borra esta semana\"",
    "  • \"resetea el mes\"",
    "  • \"empezar de cero\" (borra todo el historial)",
    "",
    "💡 *Tip:* No tienes que ser exacto, ¡entiendo lenguaje natural!",
  ].join("\n");
}

export async function buildMonthlySummary(userId: string, period: "today" | "week" | "month" = "month"): Promise<string> {
  const now = new Date();
  let start: Date;
  let end: Date;
  let periodLabel: string;

  if (period === "today") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    periodLabel = "hoy";
  } else if (period === "week") {
    end = new Date();
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    periodLabel = "esta semana";
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    periodLabel = now.toLocaleString("es-MX", { month: "long" });
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      occurredAt: { gte: start, lt: end },
    },
  });

  if (transactions.length === 0) {
    return [
      `📊 *Resumen de ${periodLabel}*`,
      "",
      `No tienes movimientos registrados ${period === "today" ? "hoy" : `en ${periodLabel}`}.`,
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
    `📊 *Resumen de ${periodLabel}*`,
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

import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ALERT_THRESHOLDS } from "@finance/shared";

interface AlertNotification {
  userId: string;
  phone: string;
  message: string;
  ruleId: string;
}

/**
 * Run all alert rules for all users.
 * Returns a list of notifications to send via WhatsApp.
 */
export async function runAlerts(): Promise<AlertNotification[]> {
  const notifications: AlertNotification[] = [];

  const rules = await prisma.alertRule.findMany({
    where: { enabled: true },
    include: { user: true },
  });

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // Group rules by user for efficiency
  const rulesByUser = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByUser.get(rule.userId) || [];
    list.push(rule);
    rulesByUser.set(rule.userId, list);
  }

  for (const [userId, userRules] of rulesByUser) {
    const user = userRules[0].user;

    // Fetch all active transactions for the month
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        occurredAt: { gte: startOfMonth, lt: endOfMonth },
      },
    });

    const expenses = transactions.filter((t) => t.transactionType === "expense");
    const income = transactions.filter((t) => t.transactionType === "income");
    const totalExpenses = expenses.reduce((sum, t) => sum + t.amountMinor, 0);
    const totalIncome = income.reduce((sum, t) => sum + t.amountMinor, 0);

    for (const rule of userRules) {
      const result = await evaluateRule(rule, {
        userId,
        expenses,
        totalExpenses,
        totalIncome,
        startOfMonth,
      });

      if (result) {
        // Check if we already sent this alert recently (dedup within 24h)
        const recentAlert = await prisma.alertEvent.findFirst({
          where: {
            ruleId: rule.id,
            sentAt: { gt: new Date(Date.now() - 24 * 60 * 60_000) },
          },
        });

        if (!recentAlert) {
          notifications.push({
            userId,
            phone: user.phone,
            message: result,
            ruleId: rule.id,
          });
        }
      }
    }
  }

  // Save alert events
  for (const n of notifications) {
    await prisma.alertEvent.create({
      data: {
        userId: n.userId,
        ruleId: n.ruleId,
        message: n.message,
      },
    });
  }

  logger.info({ count: notifications.length }, "Alerts evaluated");
  return notifications;
}

// ── Rule evaluation ───────────────────────────────────────────────

interface EvalContext {
  userId: string;
  expenses: Array<{ category: string; amountMinor: number; createdAt: Date }>;
  totalExpenses: number;
  totalIncome: number;
  startOfMonth: Date;
}

type RuleWithUser = Awaited<ReturnType<typeof prisma.alertRule.findMany>>[number];

async function evaluateRule(
  rule: RuleWithUser,
  ctx: EvalContext,
): Promise<string | null> {
  switch (rule.type) {
    case "category_limit":
      return evaluateCategoryLimit(rule, ctx);
    case "negative_balance":
      return evaluateNegativeBalance(ctx);
    case "unusual_expense":
      return evaluateUnusualExpense(ctx);
    default:
      return null;
  }
}

function formatMoney(minor: number): string {
  return (minor / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Category limit (80% / 100%) ───────────────────────────────────

function evaluateCategoryLimit(
  rule: RuleWithUser,
  ctx: EvalContext,
): string | null {
  if (!rule.category || !rule.thresholdMinor) return null;

  const spent = ctx.expenses
    .filter((t) => t.category === rule.category)
    .reduce((sum, t) => sum + t.amountMinor, 0);

  const ratio = spent / rule.thresholdMinor;

  // Check thresholds from highest to lowest
  for (const threshold of [...ALERT_THRESHOLDS].reverse()) {
    if (ratio >= threshold) {
      const pct = Math.round(threshold * 100);
      const icon = threshold >= 1.0 ? "🔴" : "⚠️";
      const label = CATEGORY_LABELS[rule.category] || rule.category;
      return [
        `${icon} *Alerta: ${label}*`,
        "",
        `Llevas $${formatMoney(spent)} de tu límite de $${formatMoney(rule.thresholdMinor)} (${pct}%).`,
        threshold >= 1.0
          ? "¡Ya superaste tu límite!"
          : "Estás cerca de tu límite.",
      ].join("\n");
    }
  }

  return null;
}

// ── Negative balance ──────────────────────────────────────────────

function evaluateNegativeBalance(ctx: EvalContext): string | null {
  const balance = ctx.totalIncome - ctx.totalExpenses;
  if (balance >= 0) return null;

  return [
    "🔴 *Alerta: Balance negativo*",
    "",
    `Tus gastos ($${formatMoney(ctx.totalExpenses)}) superan tus ingresos ($${formatMoney(ctx.totalIncome)}).`,
    `Balance: -$${formatMoney(Math.abs(balance))}`,
  ].join("\n");
}

// ── Unusual expense ───────────────────────────────────────────────

async function evaluateUnusualExpense(ctx: EvalContext): Promise<string | null> {
  // Compare the latest expense against the average of the last 30 days
  const latestExpense = ctx.expenses
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!latestExpense) return null;

  // Get last 30 days of expenses to compute average
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const recentExpenses = await prisma.transaction.findMany({
    where: {
      userId: ctx.userId,
      transactionType: "expense",
      deletedAt: null,
      occurredAt: { gte: thirtyDaysAgo },
    },
  });

  if (recentExpenses.length < 5) return null; // not enough data

  const avgAmount =
    recentExpenses.reduce((sum, t) => sum + t.amountMinor, 0) / recentExpenses.length;

  // Alert if latest expense is more than 3x the average
  if (latestExpense.amountMinor > avgAmount * 3) {
    return [
      "⚠️ *Gasto inusual detectado*",
      "",
      `Tu último gasto ($${formatMoney(latestExpense.amountMinor)}) es mucho mayor que tu promedio ($${formatMoney(Math.round(avgAmount))}).`,
    ].join("\n");
  }

  return null;
}

// ── Weekly summary builder ────────────────────────────────────────

export async function buildWeeklySummary(userId: string): Promise<string> {
  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      occurredAt: { gte: weekAgo, lt: now },
    },
    orderBy: { occurredAt: "desc" },
  });

  if (transactions.length === 0) {
    return "📊 *Resumen semanal*\n\nNo tuviste movimientos esta semana.";
  }

  const expenses = transactions.filter((t) => t.transactionType === "expense");
  const income = transactions.filter((t) => t.transactionType === "income");
  const totalExpenses = expenses.reduce((sum, t) => sum + t.amountMinor, 0);
  const totalIncome = income.reduce((sum, t) => sum + t.amountMinor, 0);

  // Top 3 expenses
  const topExpenses = expenses
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 3)
    .map((t) => `  💸 $${formatMoney(t.amountMinor)} — ${t.description || t.category}`);

  const lines = [
    "📊 *Resumen semanal*",
    "",
    `💸 Gastos: $${formatMoney(totalExpenses)}`,
    `💰 Ingresos: $${formatMoney(totalIncome)}`,
    `📝 ${transactions.length} movimientos`,
  ];

  if (topExpenses.length > 0) {
    lines.push("", "🔝 *Gastos más grandes:*", ...topExpenses);
  }

  return lines.join("\n");
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

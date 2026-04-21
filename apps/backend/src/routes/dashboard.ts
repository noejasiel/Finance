import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { getAuthenticatedUserId } from "./auth.js";

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/v1/dashboard/month?month=2026-04
  app.get(`${API_PREFIX}/dashboard/month`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const { month } = req.query as { month?: string };
    const now = new Date();
    const targetMonth = month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [year, m] = targetMonth.split("-").map(Number);

    const startDate = new Date(Date.UTC(year, m - 1, 1));
    const endDate = new Date(Date.UTC(year, m, 1));
    const prevStartDate = new Date(Date.UTC(year, m - 2, 1));

    const [currentTxs, prevTxs] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, occurredAt: { gte: startDate, lt: endDate } },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, occurredAt: { gte: prevStartDate, lt: startDate } },
      }),
    ]);

    const totalExpenses = currentTxs
      .filter((t) => t.transactionType === "expense")
      .reduce((sum, t) => sum + t.amountMinor, 0);

    const totalIncome = currentTxs
      .filter((t) => t.transactionType === "income")
      .reduce((sum, t) => sum + t.amountMinor, 0);

    const prevExpenses = prevTxs
      .filter((t) => t.transactionType === "expense")
      .reduce((sum, t) => sum + t.amountMinor, 0);

    const prevIncome = prevTxs
      .filter((t) => t.transactionType === "income")
      .reduce((sum, t) => sum + t.amountMinor, 0);

    // Group by category
    const categoryMap = new Map<string, number>();
    for (const tx of currentTxs.filter((t) => t.transactionType === "expense")) {
      categoryMap.set(tx.category, (categoryMap.get(tx.category) || 0) + tx.amountMinor);
    }
    const byCategory = Array.from(categoryMap.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    // Weekly trend
    const weeklyMap = new Map<number, { expenses: number; income: number }>();
    for (const tx of currentTxs) {
      const day = new Date(tx.occurredAt).getUTCDate();
      const week = Math.ceil(day / 7);
      const entry = weeklyMap.get(week) || { expenses: 0, income: 0 };
      if (tx.transactionType === "expense") entry.expenses += tx.amountMinor;
      else entry.income += tx.amountMinor;
      weeklyMap.set(week, entry);
    }
    const weeklyTrend = Array.from(weeklyMap.entries())
      .map(([week, data]) => ({ week, ...data }))
      .sort((a, b) => a.week - b.week);

    // Top 5 expenses
    const topExpenses = currentTxs
      .filter((t) => t.transactionType === "expense")
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, 5)
      .map((t) => ({
        description: t.description,
        amount_minor: t.amountMinor,
        category: t.category,
        occurred_at: t.occurredAt.toISOString(),
      }));

    const expenseDeltaPct = prevExpenses > 0 ? ((totalExpenses - prevExpenses) / prevExpenses) * 100 : null;
    const incomeDeltaPct = prevIncome > 0 ? ((totalIncome - prevIncome) / prevIncome) * 100 : null;

    return reply.send({
      ok: true,
      data: {
        month: targetMonth,
        total_expenses: totalExpenses,
        total_income: totalIncome,
        balance: totalIncome - totalExpenses,
        currency: "MXN",
        by_category: byCategory,
        weekly_trend: weeklyTrend,
        top_expenses: topExpenses,
        comparison: {
          prev_expenses: prevExpenses,
          prev_income: prevIncome,
          expense_delta_pct: expenseDeltaPct !== null ? Math.round(expenseDeltaPct * 100) / 100 : null,
          income_delta_pct: incomeDeltaPct !== null ? Math.round(incomeDeltaPct * 100) / 100 : null,
        },
      },
    });
  });
}

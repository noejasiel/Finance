import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { getAuthenticatedUserId } from "./auth.js";

export async function meRoutes(app: FastifyInstance) {
  // GET /api/v1/me/summary — monthly totals + balance
  app.get(`${API_PREFIX}/me/summary`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const now = new Date();
    const { month } = req.query as { month?: string };
    const targetMonth = month || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [year, m] = targetMonth.split("-").map(Number);

    const startDate = new Date(Date.UTC(year, m - 1, 1));
    const endDate = new Date(Date.UTC(year, m, 1));
    const prevStart = new Date(Date.UTC(year, m - 2, 1));

    const [currentTxs, prevTxs] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, occurredAt: { gte: startDate, lt: endDate } },
      }),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null, occurredAt: { gte: prevStart, lt: startDate } },
      }),
    ]);

    const totalExpenses = currentTxs.filter((t) => t.transactionType === "expense").reduce((s, t) => s + t.amountMinor, 0);
    const totalIncome = currentTxs.filter((t) => t.transactionType === "income").reduce((s, t) => s + t.amountMinor, 0);
    const prevExpenses = prevTxs.filter((t) => t.transactionType === "expense").reduce((s, t) => s + t.amountMinor, 0);
    const prevIncome = prevTxs.filter((t) => t.transactionType === "income").reduce((s, t) => s + t.amountMinor, 0);

    const expenseDelta = prevExpenses > 0 ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 10000) / 100 : null;
    const incomeDelta = prevIncome > 0 ? Math.round(((totalIncome - prevIncome) / prevIncome) * 10000) / 100 : null;

    return reply.send({
      ok: true,
      data: {
        month: targetMonth,
        total_expenses: totalExpenses,
        total_income: totalIncome,
        balance: totalIncome - totalExpenses,
        currency: "MXN",
        expense_delta_pct: expenseDelta,
        income_delta_pct: incomeDelta,
      },
    });
  });

  // GET /api/v1/me/transactions — paginated list with filters
  app.get(`${API_PREFIX}/me/transactions`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const { month, category, type, limit: l, offset: o } = req.query as {
      month?: string; category?: string; type?: string; limit?: string; offset?: string;
    };
    const limit = Math.min(parseInt(l || "20", 10) || 20, 100);
    const offset = parseInt(o || "0", 10) || 0;

    const where: Record<string, unknown> = { userId, deletedAt: null };

    if (month) {
      const [year, m] = month.split("-").map(Number);
      where.occurredAt = {
        gte: new Date(Date.UTC(year, m - 1, 1)),
        lt: new Date(Date.UTC(year, m, 1)),
      };
    }
    if (category) where.category = category;
    if (type) where.transactionType = type;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.transaction.count({ where }),
    ]);

    return reply.send({ ok: true, data: { transactions, total, limit, offset } });
  });

  // GET /api/v1/me/chart — weekly data for charts
  app.get(`${API_PREFIX}/me/chart`, async (req, reply) => {
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

    const txs = await prisma.transaction.findMany({
      where: { userId, deletedAt: null, occurredAt: { gte: startDate, lt: endDate } },
    });

    const weeklyMap = new Map<number, { expenses: number; income: number }>();
    for (const tx of txs) {
      const day = new Date(tx.occurredAt).getUTCDate();
      const week = Math.ceil(day / 7);
      const entry = weeklyMap.get(week) || { expenses: 0, income: 0 };
      if (tx.transactionType === "expense") entry.expenses += tx.amountMinor;
      else entry.income += tx.amountMinor;
      weeklyMap.set(week, entry);
    }

    const weekly_trend = Array.from(weeklyMap.entries())
      .map(([week, data]) => ({ week, ...data }))
      .sort((a, b) => a.week - b.week);

    return reply.send({ ok: true, data: { month: targetMonth, weekly_trend } });
  });

  // GET /api/v1/me/categories — expenses by category for the month
  app.get(`${API_PREFIX}/me/categories`, async (req, reply) => {
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

    const expenses = await prisma.transaction.findMany({
      where: {
        userId,
        transactionType: "expense",
        deletedAt: null,
        occurredAt: { gte: startDate, lt: endDate },
      },
    });

    const categoryMap = new Map<string, number>();
    for (const tx of expenses) {
      categoryMap.set(tx.category, (categoryMap.get(tx.category) || 0) + tx.amountMinor);
    }

    const by_category = Array.from(categoryMap.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    return reply.send({ ok: true, data: { month: targetMonth, by_category } });
  });

  // DELETE /api/v1/me/transactions/:id
  app.delete(`${API_PREFIX}/me/transactions/:id`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const { id } = req.params as { id: string };
    const tx = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
    if (!tx) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Transaction not found" } });
    }

    await prisma.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.send({ ok: true, data: { message: "Transaction deleted" } });
  });

  // PATCH /api/v1/me/transactions/:id
  app.patch(`${API_PREFIX}/me/transactions/:id`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const { id } = req.params as { id: string };
    const tx = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null } });
    if (!tx) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Transaction not found" } });
    }

    const body = req.body as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};
    if (body.amount_minor !== undefined) updateData.amountMinor = body.amount_minor;
    if (body.currency !== undefined) updateData.currency = body.currency;
    if (body.transaction_type !== undefined) updateData.transactionType = body.transaction_type;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.occurred_at !== undefined) updateData.occurredAt = new Date(body.occurred_at as string);

    const updated = await prisma.transaction.update({ where: { id }, data: updateData });
    return reply.send({ ok: true, data: { transaction: updated } });
  });

  // GET /api/v1/me — current user info
  app.get(`${API_PREFIX}/me`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }

    return reply.send({
      ok: true,
      data: {
        user: {
          id: user.id,
          phone: user.phone,
          name: user.name,
          role: user.role,
          timezone: user.timezone,
        },
      },
    });
  });
}

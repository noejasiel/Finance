import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { getAuthenticatedSession } from "./auth.js";

export async function adminRoutes(app: FastifyInstance) {
  // Middleware: require admin role
  app.addHook("onRequest", async (req, reply) => {
    const session = await getAuthenticatedSession(req);
    if (!session) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }
    if (session.role !== "admin") {
      return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
    }
  });

  // GET /api/v1/admin/stats — global stats
  app.get(`${API_PREFIX}/admin/stats`, async (_req, reply) => {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [totalUsers, messagesToday, activeUserIds, totalVolume] = await Promise.all([
      prisma.user.count(),
      prisma.conversationMessage.count({
        where: { createdAt: { gte: startOfDay } },
      }),
      prisma.transaction.findMany({
        where: {
          deletedAt: null,
          occurredAt: { gte: startOfMonth },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.transaction.aggregate({
        where: { deletedAt: null },
        _sum: { amountMinor: true },
      }),
    ]);

    return reply.send({
      ok: true,
      data: {
        total_users: totalUsers,
        active_this_month: activeUserIds.length,
        messages_today: messagesToday,
        total_volume: totalVolume._sum.amountMinor || 0,
      },
    });
  });

  // GET /api/v1/admin/users — list users with metrics
  app.get(`${API_PREFIX}/admin/users`, async (req, reply) => {
    const { search, limit: l, offset: o } = req.query as {
      search?: string; limit?: string; offset?: string;
    };
    const limit = Math.min(parseInt(l || "50", 10) || 50, 100);
    const offset = parseInt(o || "0", 10) || 0;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { transactions: true, messages: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Get per-user monthly stats
    const userIds = users.map((u) => u.id);
    const monthlyTxs = await prisma.transaction.groupBy({
      by: ["userId", "transactionType"],
      where: {
        userId: { in: userIds },
        deletedAt: null,
        occurredAt: { gte: startOfMonth, lt: endOfMonth },
      },
      _sum: { amountMinor: true },
      _count: true,
    });

    // Get last message per user
    const lastMessages = await prisma.conversationMessage.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: "desc" },
      distinct: ["userId"],
      select: { userId: true, createdAt: true },
    });

    const lastMsgMap = new Map(lastMessages.map((m) => [m.userId, m.createdAt]));

    const enrichedUsers = users.map((u) => {
      const userTxs = monthlyTxs.filter((t) => t.userId === u.id);
      const monthExpenses = userTxs.find((t) => t.transactionType === "expense")?._sum.amountMinor || 0;
      const monthIncome = userTxs.find((t) => t.transactionType === "income")?._sum.amountMinor || 0;
      const monthTxCount = userTxs.reduce((s, t) => s + t._count, 0);

      return {
        id: u.id,
        phone: u.phone,
        name: u.name,
        role: u.role,
        created_at: u.createdAt.toISOString(),
        last_message_at: lastMsgMap.get(u.id)?.toISOString() ?? null,
        month_transactions: monthTxCount,
        month_expenses: monthExpenses,
        month_income: monthIncome,
        month_balance: monthIncome - monthExpenses,
      };
    });

    return reply.send({ ok: true, data: { users: enrichedUsers, total, limit, offset } });
  });

  // GET /api/v1/admin/users/:id — user detail
  app.get(`${API_PREFIX}/admin/users/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        transactions: {
          where: { deletedAt: null },
          orderBy: { occurredAt: "desc" },
          take: 10,
        },
      },
    });

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
          created_at: user.createdAt.toISOString(),
        },
        recent_transactions: user.transactions,
      },
    });
  });

  // GET /api/v1/admin/activity — messages per day (last 30 days)
  app.get(`${API_PREFIX}/admin/activity`, async (_req, reply) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const messages = await prisma.conversationMessage.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true },
    });

    const dayMap = new Map<string, number>();
    for (const msg of messages) {
      const day = msg.createdAt.toISOString().split("T")[0];
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }

    const activity = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return reply.send({ ok: true, data: { activity } });
  });
}

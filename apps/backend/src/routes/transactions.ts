import type { FastifyInstance } from "fastify";
import {
  TransactionsQuerySchema,
  PatchTransactionSchema,
  API_PREFIX,
} from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { getAuthenticatedUserId } from "./auth.js";

export async function transactionRoutes(app: FastifyInstance) {
  const prefix = `${API_PREFIX}/transactions`;

  // GET /api/v1/transactions
  app.get(prefix, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const query = TransactionsQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: query.error.message } });
    }

    const { month, category, type, limit, offset } = query.data;

    const where: Record<string, unknown> = {
      userId,
      deletedAt: null,
    };

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

    return reply.send({
      ok: true,
      data: { transactions, total, limit, offset },
    });
  });

  // PATCH /api/v1/transactions/:id
  app.patch(`${prefix}/:id`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const body = PatchTransactionSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: body.error.message } });
    }

    const { id } = req.params as { id: string };

    const tx = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!tx) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Transaction not found" } });
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        ...(body.data.amount_minor !== undefined && { amountMinor: body.data.amount_minor }),
        ...(body.data.currency !== undefined && { currency: body.data.currency }),
        ...(body.data.transaction_type !== undefined && { transactionType: body.data.transaction_type }),
        ...(body.data.category !== undefined && { category: body.data.category }),
        ...(body.data.description !== undefined && { description: body.data.description }),
        ...(body.data.occurred_at !== undefined && { occurredAt: new Date(body.data.occurred_at) }),
      },
    });

    return reply.send({ ok: true, data: { transaction: updated } });
  });

  // DELETE /api/v1/transactions/:id (soft delete)
  app.delete(`${prefix}/:id`, async (req, reply) => {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const { id } = req.params as { id: string };

    const tx = await prisma.transaction.findFirst({
      where: { id, userId, deletedAt: null },
    });

    if (!tx) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Transaction not found" } });
    }

    await prisma.transaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return reply.send({ ok: true, data: { message: "Transaction deleted" } });
  });
}

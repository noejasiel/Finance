import type { FastifyInstance } from "fastify";
import { API_PREFIX, UpsertAlertsSchema } from "@finance/shared";
import { prisma } from "../lib/prisma.js";

export async function alertRoutes(app: FastifyInstance) {
  // GET /api/v1/alerts
  app.get(`${API_PREFIX}/alerts`, async (req, reply) => {
    // TODO: extract userId from session
    const userId: string | null = null;
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const rules = await prisma.alertRule.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({ ok: true, data: { rules } });
  });

  // PUT /api/v1/alerts
  app.put(`${API_PREFIX}/alerts`, async (req, reply) => {
    // TODO: extract userId from session
    const userId: string | null = null;
    if (!userId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    }

    const body = UpsertAlertsSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: body.error.message } });
    }

    // Delete existing and replace
    await prisma.$transaction([
      prisma.alertRule.deleteMany({ where: { userId } }),
      ...body.data.rules.map((rule) =>
        prisma.alertRule.create({
          data: {
            userId,
            type: rule.type,
            enabled: rule.enabled,
            category: rule.category,
            thresholdMinor: rule.threshold_minor,
            dayOfWeek: rule.day_of_week,
          },
        }),
      ),
    ]);

    const rules = await prisma.alertRule.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    return reply.send({ ok: true, data: { rules } });
  });
}

import type { FastifyInstance } from "fastify";
import { API_PREFIX } from "@finance/shared";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { isWhatsAppConnected, sendWhatsAppMessage } from "../wa/client.js";
import { runAlerts, buildWeeklySummary } from "../services/alerts.js";
import { prisma } from "../lib/prisma.js";

export async function internalRoutes(app: FastifyInstance) {
  // Auth guard for internal endpoints
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith(`${API_PREFIX}/internal/`)) return;

    const token = req.headers["x-internal-token"];
    if (token !== env().INTERNAL_API_TOKEN) {
      return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "Invalid internal token" } });
    }
  });

  // POST /api/v1/internal/send-message
  app.post(`${API_PREFIX}/internal/send-message`, async (req, reply) => {
    const { phone, message } = req.body as { phone: string; message: string };

    if (!isWhatsAppConnected()) {
      return reply.send({ ok: true, data: { sent: false, reason: "WhatsApp client not connected" } });
    }

    try {
      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        return reply.send({ ok: true, data: { sent: false, reason: "User not found" } });
      }

      await sendWhatsAppMessage(phone, message);
      logger.info({ phone }, "Internal message sent");
      return reply.send({ ok: true, data: { sent: true } });
    } catch (err) {
      logger.error({ err, phone }, "Failed to send internal message");
      return reply.send({ ok: true, data: { sent: false, reason: "Send failed" } });
    }
  });

  // POST /api/v1/internal/run-alerts
  app.post(`${API_PREFIX}/internal/run-alerts`, async (_req, reply) => {
    logger.info("Internal run-alerts triggered");

    if (!isWhatsAppConnected()) {
      return reply.send({ ok: true, data: { processed: 0, reason: "WhatsApp client not connected" } });
    }

    const notifications = await runAlerts();

    let sent = 0;
    for (const n of notifications) {
      try {
        await sendWhatsAppMessage(n.phone, n.message);
        sent++;
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        logger.error({ err, phone: n.phone }, "Failed to send alert notification");
      }
    }

    return reply.send({ ok: true, data: { processed: notifications.length, sent } });
  });

  // POST /api/v1/internal/weekly-summary
  app.post(`${API_PREFIX}/internal/weekly-summary`, async (_req, reply) => {
    logger.info("Internal weekly-summary triggered");

    if (!isWhatsAppConnected()) {
      return reply.send({ ok: true, data: { processed: 0, reason: "WhatsApp client not connected" } });
    }

    const rules = await prisma.alertRule.findMany({
      where: { type: "weekly_summary", enabled: true },
      include: { user: true },
    });

    let sent = 0;
    for (const rule of rules) {
      try {
        const summary = await buildWeeklySummary(rule.userId);
        await sendWhatsAppMessage(rule.user.phone, summary);
        sent++;

        await prisma.alertEvent.create({
          data: {
            userId: rule.userId,
            ruleId: rule.id,
            message: summary,
          },
        });

        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        logger.error({ err, userId: rule.userId }, "Failed to send weekly summary");
      }
    }

    return reply.send({ ok: true, data: { processed: rules.length, sent } });
  });
}

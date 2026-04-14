import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { getCurrentQr } from "../wa/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: "ok", db: "connected" });
    } catch {
      return reply.status(503).send({ status: "error", db: "disconnected" });
    }
  });

  // GET /qr — shows WhatsApp QR code as PNG image (only visible while not authenticated)
  app.get("/qr", async (_req, reply) => {
    const qr = getCurrentQr();
    if (!qr) {
      return reply
        .type("text/html")
        .send("<h2>No QR disponible — WhatsApp ya está conectado o aún está iniciando.</h2><p>Recarga en unos segundos.</p>");
    }
    const png = await QRCode.toBuffer(qr, { scale: 8 });
    return reply.type("image/png").send(png);
  });
}

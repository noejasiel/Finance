import type { FastifyInstance } from "fastify";
import { RequestCodeSchema, VerifyCodeSchema, OTP_LENGTH, OTP_EXPIRY_MINUTES } from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import crypto from "node:crypto";

function generateOtp(): string {
  return crypto.randomInt(100_000, 999_999).toString();
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/request-code
  app.post("/api/v1/auth/request-code", async (req, reply) => {
    const body = RequestCodeSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: body.error.message },
      });
    }

    const { phone } = body.data;
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

    // Find or create user
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    await prisma.loginChallenge.create({
      data: {
        phone,
        code,
        expiresAt,
        userId: user.id,
      },
    });

    // TODO (Phase 1): Send OTP via WhatsApp bot
    logger.info({ phone, code: env().NODE_ENV === "development" ? code : "[redacted]" }, "OTP generated");

    return reply.send({ ok: true, data: { message: "Code sent via WhatsApp" } });
  });

  // POST /api/v1/auth/verify-code
  app.post("/api/v1/auth/verify-code", async (req, reply) => {
    const body = VerifyCodeSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: body.error.message },
      });
    }

    const { phone, code } = body.data;

    const challenge = await prisma.loginChallenge.findFirst({
      where: {
        phone,
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge) {
      return reply.status(401).send({
        ok: false,
        error: { code: "INVALID_CODE", message: "Invalid or expired code" },
      });
    }

    // Mark challenge as used
    await prisma.loginChallenge.update({
      where: { id: challenge.id },
      data: { used: true },
    });

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return reply.status(404).send({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // Set session cookie
    const token = crypto.randomBytes(32).toString("hex");
    // TODO (Phase 4): store session token in DB or use signed cookie
    reply.setCookie("finance_session", token, {
      httpOnly: true,
      secure: env().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return reply.send({
      ok: true,
      data: { user: { id: user.id, phone: user.phone, timezone: user.timezone } },
    });
  });
}

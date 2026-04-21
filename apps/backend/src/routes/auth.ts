import type { FastifyInstance } from "fastify";
import { RequestCodeSchema, VerifyCodeSchema, OTP_LENGTH, OTP_EXPIRY_MINUTES, SESSION_COOKIE } from "@finance/shared";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { normalizePhoneNumber } from "../lib/phone.js";
import { sendWhatsAppMessage } from "../wa/client.js";
import crypto from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

function generateOtp(): string {
  return crypto.randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();
}

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export interface SessionPayload extends JWTPayload {
  userId: string;
  phone: string;
  role: string;
}

export async function createSessionToken(user: { id: string; phone: string; role: string }): Promise<string> {
  return new SignJWT({ userId: user.id, phone: user.phone, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Extract authenticated user ID from request cookie.
 */
export async function getAuthenticatedUserId(req: { cookies: Record<string, string | undefined> }): Promise<string | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySessionToken(token);
  return session?.userId ?? null;
}

/**
 * Extract authenticated session from request cookie.
 */
export async function getAuthenticatedSession(req: { cookies: Record<string, string | undefined> }): Promise<SessionPayload | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySessionToken(token);
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/request-otp
  app.post("/api/v1/auth/request-otp", async (req, reply) => {
    const body = RequestCodeSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: body.error.message },
      });
    }
    
    const phone = normalizePhoneNumber(body.data.phone);
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

    // Send OTP via WhatsApp
    try {
      const waJid = phone.replace(/^\+/, "") + "@s.whatsapp.net";
      await sendWhatsAppMessage(waJid, `🔐 Tu código de acceso es: *${code}*\n\nExpira en ${OTP_EXPIRY_MINUTES} minutos.`);
      logger.info({ phone, waJid }, "OTP sent via WhatsApp");
    } catch (err) {
      // If WhatsApp fails, log it but still return success (code was saved)
      logger.warn({ phone, err }, "Failed to send OTP via WhatsApp — code saved in DB");
    }

    // Also log in development
    if (env().NODE_ENV === "development") {
      logger.info({ phone, code }, "OTP generated (dev)");
    }

    return reply.send({ ok: true, data: { message: "Code sent via WhatsApp" } });
  });

  // POST /api/v1/auth/verify-otp
  app.post("/api/v1/auth/verify-otp", async (req, reply) => {
    const body = VerifyCodeSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: body.error.message },
      });
    }

    const phone = normalizePhoneNumber(body.data.phone);
    const { code } = body.data;

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

    // Create JWT and set as httpOnly cookie
    const token = await createSessionToken(user);

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

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

  // POST /api/v1/auth/logout
  app.post("/api/v1/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.send({ ok: true, data: { message: "Logged out" } });
  });
}

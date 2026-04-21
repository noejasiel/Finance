import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { transactionRoutes } from "./routes/transactions.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { alertRoutes } from "./routes/alerts.js";
import { internalRoutes } from "./routes/internal.js";
import { adminRoutes } from "./routes/admin.js";
import { initWhatsApp } from "./wa/client.js";

async function main() {
  const config = env();

  const app = Fastify({ logger: false }); // we use our own pino instance

  // Plugins
  await app.register(fastifyCors, {
    origin: config.APP_URL,
    credentials: true,
  });
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(transactionRoutes);
  await app.register(dashboardRoutes);
  await app.register(alertRoutes);
  await app.register(internalRoutes);
  await app.register(adminRoutes);

  // Start server
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "Server started");

  // Connect to DB
  await prisma.$connect();
  logger.info("Database connected");

  // Initialize WhatsApp in the background (no Chrome needed — uses WebSocket)
  initWhatsApp().catch((err) => {
    logger.error({ err }, "WhatsApp initialization failed");
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});

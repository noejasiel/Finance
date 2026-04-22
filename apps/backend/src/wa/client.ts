import {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import makeWASocket from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { join } from "path";
import fs from "fs";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { prisma } from "../lib/prisma.js";
import { findOrCreateUser, completeOnboarding } from "../services/user.js";
import { saveMessage } from "../services/conversation.js";
import {
  detectBasicIntent,
  buildGreeting,
  buildHelp,
  buildMonthlySummary,
  parseIncomeShortcut,
  getPendingConfirmation,
} from "../services/flow.js";
import { parseMessage } from "../services/parser.js";
import { getRecentMessages } from "../services/conversation.js";
import {
  createTransaction,
  buildTransactionConfirmation,
  buildConfirmationRequest,
  deleteLastTransaction,
  correctLastTransaction,
  needsConfirmation,
  checkCategoryAlerts,
  getMonthlyTotal,
  resetTransactions,
  getTransactionsForResetPreview,
  buildResetConfirmation,
  buildResetResult,
  setBudget,
  buildBudgetConfirmationRequest,
  type ResetTimeframe,
} from "../services/transaction.js";

// ── Concurrency & Presence Control ────────────────────────────────
const userQueues = new Map<string, Promise<unknown>>();
const pendingCounts = new Map<string, number>();

/**
 * Ensures that messages from the same user are processed sequentially.
 * Also tracks how many messages are waiting for the same user.
 */
async function enqueueTask(jid: string, task: () => Promise<void>) {
  pendingCounts.set(jid, (pendingCounts.get(jid) || 0) + 1);
  
  const previousTask = userQueues.get(jid) || Promise.resolve();
  const nextTask = previousTask
    .then(task)
    .catch((err) => {
      logger.error({ err, jid }, "Error in user task queue");
    })
    .finally(() => {
      const count = (pendingCounts.get(jid) || 1) - 1;
      pendingCounts.set(jid, count);
    });

  userQueues.set(jid, nextTask);
  return nextTask;
}

/**
 * Updates presence but only pauses if no more tasks are pending for that user.
 */
async function updatePresence(sock: WASocket, jid: string, state: "composing" | "paused") {
  if (state === "paused") {
    const pending = pendingCounts.get(jid) || 0;
    if (pending > 0) return; // Keep typing if more messages are in queue
  }
  await sock.sendPresenceUpdate(state, jid);
}

/**
 * Helper for natural typing delays (fixed at 2 seconds per user request).
 */
async function typingDelay() {
  await new Promise((r) => setTimeout(r, 2000));
}

let waSocket: WASocket | null = null;
let currentQr: string | null = null;

export function getCurrentQr(): string | null {
  return currentQr;
}

export function isWhatsAppConnected(): boolean {
  return waSocket !== null;
}

export async function sendWhatsAppMessage(jid: string, text: string): Promise<void> {
  if (!waSocket) throw new Error("WhatsApp not connected");
  
  await updatePresence(waSocket, jid, "composing");
  await typingDelay();
  await updatePresence(waSocket, jid, "paused");
  
  await waSocket.sendMessage(jid, { text });
}

// Silence Baileys' internal verbose logs
const silentLogger = pino({ level: "silent" });

export async function initWhatsApp(): Promise<void> {
  const authDir = join(process.cwd(), ".wa-auth");
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, "Initializing WhatsApp (Baileys)");

  const bootTimestamp = Math.floor(Date.now() / 1000);

  const allowedIds = env()
    .WA_ALLOWED_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const rateLimitMap = new Map<string, number[]>();
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 5;

  function connect() {
    useMultiFileAuthState(authDir).then(({ state, saveCreds }) => {
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        printQRInTerminal: true,
        logger: silentLogger,
        browser: ["Finance Bot", "Chrome", "1.0.0"],
      });

      waSocket = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          currentQr = qr;
          logger.info("QR code ready — visit /qr to scan");
        }

        if (connection === "open") {
          currentQr = null;
          logger.info("WhatsApp connected");
        }

        if (connection === "close") {
          waSocket = null;
          const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          logger.warn({ code, loggedOut }, "WhatsApp disconnected");

          if (loggedOut) {
            logger.info("Cleaning up session files after logout...");
            try {
              const files = fs.readdirSync(authDir);
              for (const file of files) {
                fs.rmSync(join(authDir, file), { recursive: true, force: true });
              }
            } catch (err) {
              logger.error({ err }, "Failed to clear session directory");
            }
          }

          logger.info("Reconnecting in 5s...");
          setTimeout(connect, 5_000);
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
          try {
            const jid = msg.key.remoteJid;
            if (!jid) continue;

            await enqueueTask(jid, async () => {
              await handleMessage(sock, msg, {
                bootTimestamp,
                allowedIds,
                rateLimitMap,
                RATE_LIMIT_WINDOW_MS,
                RATE_LIMIT_MAX,
              });
            });
          } catch (err) {
            logger.error({ err }, "Error enqueuing message");
          }
        }
      });
    });
  }

  connect();
}

// ── Message handler ───────────────────────────────────────────────

interface HandlerOpts {
  bootTimestamp: number;
  allowedIds: string[];
  rateLimitMap: Map<string, number[]>;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}

async function handleMessage(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  opts: HandlerOpts,
): Promise<void> {
  const { bootTimestamp, allowedIds, rateLimitMap, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } = opts;

  if (!msg.key) return;
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith("@g.us")) return;

  const ts = Number(msg.messageTimestamp ?? 0);
  if (ts < bootTimestamp) return;

  const body =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    "";
  if (!body.trim()) return;

  if (allowedIds.length > 0 && !allowedIds.includes(jid)) {
    logger.debug({ jid }, "Ignored — not in WA_ALLOWED_IDS");
    return;
  }

  const now = Date.now();
  const timestamps = rateLimitMap.get(jid) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    logger.warn({ jid }, "Rate limited");
    return;
  }
  recent.push(now);
  rateLimitMap.set(jid, recent);

  logger.info({ from: jid, body }, "Incoming WhatsApp message");

  const user = await findOrCreateUser(jid);

  await saveMessage(user.id, "user", body);

  // ── Onboarding: ask for name before normal flow ──
  if (user.onboardingStep === "name") {
    // Check if we already asked for the name (has prior assistant message)
    const priorBotMsg = await prisma.conversationMessage.findFirst({
      where: { userId: user.id, role: "assistant" },
    });

    if (!priorBotMsg) {
      // First contact — ask for name
      const reply = [
        "👋 ¡Hola! Soy tu asistente de finanzas.",
        "¿Cómo te llamas?",
      ].join("\n");

      await updatePresence(sock, jid, "composing");
      await typingDelay();
      await updatePresence(sock, jid, "paused");
      
      await sock.sendMessage(jid, { text: reply });
      await saveMessage(user.id, "assistant", reply);
      logger.info({ to: jid }, "Onboarding: asked for name");
      return;
    }

    // User is replying with their name
    const name = body.trim().split(/\s+/).slice(0, 3).join(" ");
    await completeOnboarding(user.id, name);

    const appUrl = env().APP_URL;
    const reply = [
      `¡Listo, ${name}! 💰 Ya puedes registrar gastos e ingresos.`,
      "Escribe *ayuda* para ver cómo funciono.",
      "",
      "También puedes ver tus finanzas en la web:",
      `👉 ${appUrl}`,
    ].join("\n");

    await updatePresence(sock, jid, "composing");
    await typingDelay();
    await updatePresence(sock, jid, "paused");
    
    await sock.sendMessage(jid, { text: reply });
    await saveMessage(user.id, "assistant", reply);
    logger.info({ to: jid, name }, "Onboarding: complete");
    return;
  }

  // ── Normal flow (onboarding done) ──
  const pending = await getPendingConfirmation(user.id);
  const intent = detectBasicIntent(body, !!pending);
  let reply: string;

  switch (intent) {
    case "confirm_yes": {
      if (pending?.intent === "reset_data") {
        const count = await resetTransactions(
          user.id,
          (pending.reset_timeframe ?? "all") as ResetTimeframe,
          pending.reset_count
        );
        reply = buildResetResult(count, (pending.reset_timeframe ?? "all") as ResetTimeframe);
      } else if (pending?.intent === "set_alert" && pending?.category && pending?.amount_minor) {
        reply = await setBudget(user.id, pending.category, pending.amount_minor);
      } else if (pending?.amount_minor && pending?.transaction_type) {
        await createTransaction(user.id, pending);
        const total = await getMonthlyTotal(user.id, pending.transaction_type);
        reply = buildTransactionConfirmation(pending, total);
        if (pending.transaction_type === "expense") {
          const alert = await checkCategoryAlerts(user.id, pending.category ?? "other");
          if (alert) reply += alert;
        }
      } else {
        reply = "No hay nada pendiente por confirmar.";
      }
      break;
    }
    case "confirm_no":
      reply = "👌 Cancelado. No se guardó nada.";
      break;
    case "greeting":
      reply = buildGreeting(false);
      break;
    case "help":
      reply = buildHelp();
      break;
    case "summary_request": {
      const lower = body.toLowerCase();
      const summaryPeriod = /\b(hoy|d[ií]a|dia)\b/.test(lower)
        ? "today" as const
        : /\b(semana|7\s*d[ií]as)\b/.test(lower)
          ? "week" as const
          : "month" as const;
      reply = await buildMonthlySummary(user.id, summaryPeriod);
      break;
    }
    case "income_shortcut": {
      const incomeParsed = parseIncomeShortcut(body);
      if (incomeParsed) {
        await createTransaction(user.id, incomeParsed);
        const incomeTotal = await getMonthlyTotal(user.id, "income");
        reply = buildTransactionConfirmation(incomeParsed, incomeTotal);
      } else {
        reply = "No entendí el monto. Ejemplo: *+300 freelance*";
      }
      break;
    }
    case "reset_request": {
      // Pre-caught by regex — ask AI specifically to determine the timeframe
      const resetContext = await getRecentMessages(user.id);
      const resetParsed = await parseMessage(body, resetContext);

      // Use AI result if valid, otherwise default to "all"
      const timeframe: ResetTimeframe =
        (resetParsed?.intent === "reset_data" && resetParsed?.reset_timeframe
          ? resetParsed.reset_timeframe
          : "all") as ResetTimeframe;

      // Build the confirmation request with the detected timeframe
      const resetData = {
        intent: "reset_data" as const,
        confidence: 1,
        amount_minor: null,
        currency: "MXN" as const,
        transaction_type: null,
        category: null,
        description: null,
        occurred_at: null,
        needs_confirmation: true,
        reset_timeframe: timeframe,
        reset_count: resetParsed?.reset_count ?? null,
        correction: null,
      };

      const preview = await getTransactionsForResetPreview(user.id, timeframe, resetData.reset_count);
      reply = buildResetConfirmation(timeframe, preview.list, preview.count, resetData.reset_count);
      await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(resetData)));
      
      await updatePresence(sock, jid, "composing");
      await typingDelay();
      await updatePresence(sock, jid, "paused");
      
      await sock.sendMessage(jid, { text: reply });
      logger.info({ to: jid, intent: "reset_confirmation", timeframe }, "Reply sent");
      return;
    }
    case "transaction": {
      const context = await getRecentMessages(user.id);
      const parsed = await parseMessage(body, context);

      if (!parsed || parsed.intent === "unknown") {
        reply = "No entendí tu mensaje. Escribe *ayuda* para ver lo que puedo hacer.";
        break;
      }

      if (parsed.intent === "delete_last") {
        reply = await deleteLastTransaction(user.id);
        break;
      }

      if (parsed.intent === "correct_last" && parsed.correction) {
        reply = await correctLastTransaction(
          user.id,
          parsed.correction.field,
          parsed.correction.new_value,
        );
        break;
      }

      if (parsed.intent === "reset_data" && (parsed.reset_timeframe || parsed.reset_count)) {
        // Ask for confirmation before wiping data
        const tf = (parsed.reset_timeframe ?? "all") as ResetTimeframe;
        const preview = await getTransactionsForResetPreview(user.id, tf, parsed.reset_count);
        reply = buildResetConfirmation(tf, preview.list, preview.count, parsed.reset_count);
        await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(parsed)));
        
        await updatePresence(sock, jid, "composing");
        await typingDelay();
        await updatePresence(sock, jid, "paused");
        
        await sock.sendMessage(jid, { text: reply });
        logger.info({ to: jid, intent: "reset_confirmation" }, "Reply sent");
        return;
      }

      if (parsed.intent === "set_alert" && parsed.amount_minor && parsed.category) {
        reply = buildBudgetConfirmationRequest(parsed.amount_minor, parsed.category);
        await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(parsed)));
        
        await updatePresence(sock, jid, "composing");
        await typingDelay();
        await updatePresence(sock, jid, "paused");
        
        await sock.sendMessage(jid, { text: reply });
        logger.info({ to: jid, intent: "budget_confirmation" }, "Reply sent");
        return;
      }

      if (parsed.intent === "log_transaction" && parsed.amount_minor && parsed.transaction_type) {
        if (needsConfirmation(parsed)) {
          reply = buildConfirmationRequest(parsed);
          await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(parsed)));
          
          await updatePresence(sock, jid, "composing");
          await typingDelay();
          await updatePresence(sock, jid, "paused");
          
          await sock.sendMessage(jid, { text: reply });
          logger.info({ to: jid, intent: "confirmation_request" }, "Reply sent");
          return;
        }

        await createTransaction(user.id, parsed);
        const txTotal = await getMonthlyTotal(user.id, parsed.transaction_type!);
        reply = buildTransactionConfirmation(parsed, txTotal);
        if (parsed.transaction_type === "expense") {
          const alert = await checkCategoryAlerts(user.id, parsed.category ?? "other");
          if (alert) reply += alert;
        }
        break;
      }

      if (parsed.intent === "analyze_expenses") {
        const timeframe = parsed.analyze_timeframe ?? "month";
        const { buildExpensesAnalysis } = await import("../services/analysis.js");
        reply = await buildExpensesAnalysis(user.id, timeframe);
        break;
      }

      reply = "No entendí tu mensaje. Escribe *ayuda* para ver lo que puedo hacer.";
      break;
    }
    default:
      reply = "Lo siento, solo puedo ayudarte con tus finanzas personales. Prueba registrando un gasto o pidiendo un resumen. Escribe *ayuda* para ver más.";
  }

  await updatePresence(sock, jid, "composing");
  await typingDelay();
  await updatePresence(sock, jid, "paused");

  await sock.sendMessage(jid, { text: reply });
  logger.info({ to: jid, intent }, "Reply sent");

  await saveMessage(user.id, "assistant", reply);
}

import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import type { Client as WAClient } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";
import { findOrCreateUser } from "../services/user.js";
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
} from "../services/transaction.js";

let waClient: WAClient | null = null;
let currentQr: string | null = null;

export function getCurrentQr(): string | null {
  return currentQr;
}

/**
 * Initialize the WhatsApp client.
 * - In development: uses LocalAuth (filesystem session).
 * - In production: will use RemoteAuth backed by Postgres (Phase 1).
 */
export async function initWhatsApp(): Promise<WAClient> {
  if (waClient) return waClient;

  const strategy = env().WA_AUTH_STRATEGY;
  logger.info({ strategy }, "Initializing WhatsApp client");

  // Phase 0: only LocalAuth for dev. RemoteAuth with PgStore comes in Phase 1.
  const authStrategy = new LocalAuth();

  waClient = new Client({
    authStrategy,
    webVersionCache: {
      type: "none",
    },
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
      ],
    },
  });

  waClient.on("qr", (qr) => {
    logger.info("QR code received — scan with WhatsApp");
    currentQr = qr;
    qrcode.generate(qr, { small: true });
  });

  waClient.on("ready", () => {
    currentQr = null;
    logger.info("WhatsApp client is ready");
  });

  waClient.on("authenticated", () => {
    logger.info("WhatsApp client authenticated");
  });

  waClient.on("auth_failure", (msg) => {
    logger.error({ msg }, "WhatsApp auth failure");
  });

  waClient.on("disconnected", (reason) => {
    logger.warn({ reason }, "WhatsApp client disconnected");
    waClient = null;
  });

  // Track boot time so we ignore old messages that arrive on connect
  const bootTimestamp = Date.now() / 1000;

  // Dev whitelist — only these IDs can talk to the bot (empty = allow all)
  const allowedIds = env().WA_ALLOWED_IDS
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Simple rate limit: max 5 messages per user per 60 seconds
  const rateLimitMap = new Map<string, number[]>();
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 5;

  waClient.on("message", async (message) => {
    // Ignore own messages
    if (message.fromMe) return;

    // Ignore group messages — bot only works in private chats
    if (message.from.endsWith("@g.us")) return;

    // Ignore old messages that arrive when the client first connects
    if (message.timestamp < bootTimestamp) return;

    // Ignore empty messages (media, stickers, etc.)
    if (!message.body || message.body.trim() === "") return;

    // Dev whitelist check
    if (allowedIds.length > 0 && !allowedIds.includes(message.from)) {
      logger.debug({ from: message.from }, "Ignored — not in WA_ALLOWED_IDS");
      return;
    }

    // Rate limit check
    const now = Date.now();
    const timestamps = rateLimitMap.get(message.from) || [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      logger.warn({ from: message.from }, "Rate limited");
      return;
    }
    recent.push(now);
    rateLimitMap.set(message.from, recent);

    logger.info({ from: message.from, body: message.body }, "Incoming WhatsApp message");

    try {
      // Find or create user in DB
      const user = await findOrCreateUser(message.from);
      const isNewUser = Date.now() - new Date(user.createdAt).getTime() < 5000;

      // Save user message
      await saveMessage(user.id, "user", message.body);

      // Check for pending confirmation before detecting intent
      const pending = await getPendingConfirmation(user.id);
      const intent = detectBasicIntent(message.body, !!pending);
      let reply: string;

      switch (intent) {
        case "confirm_yes": {
          if (pending && pending.amount_minor && pending.transaction_type) {
            await createTransaction(user.id, pending);
            reply = buildTransactionConfirmation(pending);
            if (pending.transaction_type === "expense") {
              const alert = await checkCategoryAlerts(user.id, pending.category || "other");
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
          reply = buildGreeting(isNewUser);
          break;
        case "help":
          reply = buildHelp();
          break;
        case "summary_request":
          reply = await buildMonthlySummary(user.id);
          break;
        case "income_shortcut": {
          const incomeParsed = parseIncomeShortcut(message.body);
          if (incomeParsed) {
            await createTransaction(user.id, incomeParsed);
            reply = buildTransactionConfirmation(incomeParsed);
          } else {
            reply = "No entendí el monto. Ejemplo: *+300 freelance*";
          }
          break;
        }
        case "transaction": {
          // Parse with OpenAI
          const context = await getRecentMessages(user.id);
          const parsed = await parseMessage(message.body, context);

          if (!parsed || parsed.intent === "unknown") {
            reply = "No entendí tu mensaje. Escribe *ayuda* para ver lo que puedo hacer.";
            break;
          }

          // Handle delete_last
          if (parsed.intent === "delete_last") {
            reply = await deleteLastTransaction(user.id);
            break;
          }

          // Handle correct_last
          if (parsed.intent === "correct_last" && parsed.correction) {
            reply = await correctLastTransaction(
              user.id,
              parsed.correction.field,
              parsed.correction.new_value,
            );
            break;
          }

          // Handle log_transaction
          if (parsed.intent === "log_transaction" && parsed.amount_minor && parsed.transaction_type) {
            if (needsConfirmation(parsed)) {
              // Store pending parse in conversation for context, ask user
              reply = buildConfirmationRequest(parsed);
              await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(parsed)));
              // Typing + send, then return early (don't double-save)
              try {
                const chat = await message.getChat();
                await chat.sendStateTyping();
              } catch { /* best-effort */ }
              const d = Math.floor(Math.random() * 1500) + 1500;
              await new Promise((r) => setTimeout(r, d));
              await waClient!.sendMessage(message.from, reply);
              logger.info({ to: message.from, intent: "confirmation_request" }, "Reply sent");
              return;
            }

            await createTransaction(user.id, parsed);
            reply = buildTransactionConfirmation(parsed);
            // Check real-time category alerts
            if (parsed.transaction_type === "expense") {
              const alert = await checkCategoryAlerts(user.id, parsed.category || "other");
              if (alert) reply += alert;
            }
            break;
          }

          reply = "No entendí tu mensaje. Escribe *ayuda* para ver lo que puedo hacer.";
          break;
        }
        default:
          reply = "No entendí tu mensaje. Escribe *ayuda* para ver lo que puedo hacer.";
      }

      // Typing indicator + delay
      try {
        const chat = await message.getChat();
        await chat.sendStateTyping();
      } catch { /* typing state is best-effort */ }
      const delay = Math.floor(Math.random() * 1500) + 1500;
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Send reply
      await waClient!.sendMessage(message.from, reply);
      logger.info({ to: message.from, intent }, "Reply sent");

      // Save bot reply
      await saveMessage(user.id, "assistant", reply);
    } catch (err) {
      logger.error({ err, from: message.from }, "Error handling message");
    }
  });

  await waClient.initialize();
  return waClient;
}

export function getWhatsAppClient(): WAClient | null {
  return waClient;
}

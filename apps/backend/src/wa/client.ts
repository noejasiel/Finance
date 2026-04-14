import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { join } from "path";
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
  await waSocket.sendMessage(jid, { text });
}

// Silence Baileys' internal verbose logs
const silentLogger = pino({ level: "silent" });

export async function initWhatsApp(): Promise<void> {
  const authDir = join(process.cwd(), ".wa-auth");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

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

        if (!loggedOut) {
          logger.info("Reconnecting in 5s...");
          setTimeout(connect, 5_000);
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        try {
          await handleMessage(sock, msg, {
            bootTimestamp,
            allowedIds,
            rateLimitMap,
            RATE_LIMIT_WINDOW_MS,
            RATE_LIMIT_MAX,
          });
        } catch (err) {
          logger.error({ err }, "Error handling message");
        }
      }
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
  const isNewUser = Date.now() - new Date(user.createdAt).getTime() < 5000;

  await saveMessage(user.id, "user", body);

  const pending = await getPendingConfirmation(user.id);
  const intent = detectBasicIntent(body, !!pending);
  let reply: string;

  switch (intent) {
    case "confirm_yes": {
      if (pending?.amount_minor && pending?.transaction_type) {
        await createTransaction(user.id, pending);
        reply = buildTransactionConfirmation(pending);
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
      reply = buildGreeting(isNewUser);
      break;
    case "help":
      reply = buildHelp();
      break;
    case "summary_request":
      reply = await buildMonthlySummary(user.id);
      break;
    case "income_shortcut": {
      const incomeParsed = parseIncomeShortcut(body);
      if (incomeParsed) {
        await createTransaction(user.id, incomeParsed);
        reply = buildTransactionConfirmation(incomeParsed);
      } else {
        reply = "No entendí el monto. Ejemplo: *+300 freelance*";
      }
      break;
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

      if (parsed.intent === "log_transaction" && parsed.amount_minor && parsed.transaction_type) {
        if (needsConfirmation(parsed)) {
          reply = buildConfirmationRequest(parsed);
          await saveMessage(user.id, "assistant", reply, JSON.parse(JSON.stringify(parsed)));
          await sock.sendPresenceUpdate("composing", jid);
          const d = Math.floor(Math.random() * 1500) + 1500;
          await new Promise((r) => setTimeout(r, d));
          await sock.sendPresenceUpdate("paused", jid);
          await sock.sendMessage(jid, { text: reply });
          logger.info({ to: jid, intent: "confirmation_request" }, "Reply sent");
          return;
        }

        await createTransaction(user.id, parsed);
        reply = buildTransactionConfirmation(parsed);
        if (parsed.transaction_type === "expense") {
          const alert = await checkCategoryAlerts(user.id, parsed.category ?? "other");
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

  await sock.sendPresenceUpdate("composing", jid);
  const delay = Math.floor(Math.random() * 1500) + 1500;
  await new Promise((resolve) => setTimeout(resolve, delay));
  await sock.sendPresenceUpdate("paused", jid);

  await sock.sendMessage(jid, { text: reply });
  logger.info({ to: jid, intent }, "Reply sent");

  await saveMessage(user.id, "assistant", reply);
}

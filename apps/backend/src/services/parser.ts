import OpenAI from "openai";
import { ParseResultSchema } from "@finance/shared";
import type { ParseResult } from "@finance/shared";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const SYSTEM_PROMPT = `Eres un asistente de finanzas personales en WhatsApp.
Tu trabajo es interpretar mensajes del usuario y extraer la intención y datos financieros.

REGLAS:
- Los montos se expresan en centavos (minor units). "45 pesos" = 4500.
- Si el usuario no especifica moneda, asume MXN.
- Si el usuario dice "dólares" o "usd", usa USD.
- Si el mensaje es ambiguo sobre el monto exacto (e.g. "como 200 y algo"), pon needs_confirmation: true y confidence < 0.7.
- Para "borra el último" usa intent: "delete_last".
- Para "eso fue un ingreso" o correcciones, usa intent: "correct_last" con el campo correction.
- Las categorías: food, transport, entertainment, health, shopping, services, housing, education, travel, salary, freelance, gift, investment, other.
- Si no puedes determinar la categoría, usa "other".
- occurred_at: ISO 8601 con timezone si se menciona fecha, null si no.
- transaction_type: "expense" por defecto, "income" si:
  • El mensaje empieza con "+" (e.g. "+15000 nómina")
  • El mensaje empieza con "mas" o "más" (e.g. "mas 200 pagina")
  • Usan palabras como: ingreso, me pagaron, cobré, me cayeron, depósito, nómina, entrada, me depositaron

- IMPORTANTE: Si el mensaje tiene errores de escritura, intenta interpretar la intención. Los usuarios escriben rápido desde el celular.
  Ejemplos: "frelance" = freelance, "gaslina" = gasolina, "cofe" = café, "ms" = más.
- Si no estás seguro pero tienes una idea de lo que quisieron decir, usa needs_confirmation: true con tu mejor interpretación.
- NUNCA pongas intent "unknown" si puedes adivinar qué quiso decir el usuario. Solo usa "unknown" si realmente no hay pistas.

Responde SOLO con JSON válido. Sin texto extra.

Schema del JSON:
{
  "intent": "log_transaction" | "delete_last" | "correct_last" | "unknown",
  "confidence": 0.0-1.0,
  "amount_minor": number | null,
  "currency": "MXN" | "USD",
  "transaction_type": "expense" | "income" | null,
  "category": string | null,
  "description": string | null,
  "occurred_at": string | null,
  "needs_confirmation": boolean,
  "correction": { "field": string, "new_value": string } | null
}`;

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Parse a user message using OpenAI and return structured financial data.
 */
export async function parseMessage(
  message: string,
  recentContext: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ParseResult | null> {
  const contextBlock =
    recentContext.length > 0
      ? `\nÚltimos mensajes:\n${recentContext.map((m) => `${m.role === "user" ? "Usuario" : "Bot"}: ${m.content}`).join("\n")}\n`
      : "";

  const userMessage = `${contextBlock}\nMensaje actual: "${message}"`;

  try {
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      logger.warn("Empty response from OpenAI");
      return null;
    }

    // Clean potential markdown wrapping
    const json = content.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

    const parsed = ParseResultSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.flatten(), raw: json }, "OpenAI response failed Zod validation");
      return null;
    }

    logger.info({ intent: parsed.data.intent, confidence: parsed.data.confidence }, "Message parsed");
    return parsed.data;
  } catch (err) {
    logger.error({ err }, "OpenAI parse error");
    return null;
  }
}

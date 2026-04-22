import { prisma } from "../lib/prisma.js";
import OpenAI from "openai";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const CATEGORY_LABELS: Record<string, string> = {
  food: "Comida",
  transport: "Transporte",
  entertainment: "Entretenimiento",
  health: "Salud",
  shopping: "Compras",
  services: "Servicios",
  housing: "Hogar",
  education: "Educación",
  travel: "Viajes",
  salary: "Salario",
  freelance: "Freelance",
  gift: "Regalos",
  investment: "Inversión",
  other: "Otros",
};

let openai: OpenAI | null = null;
function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: env().OPENAI_API_KEY });
  }
  return openai;
}

export async function buildExpensesAnalysis(
  userId: string,
  timeframe: "week" | "15days" | "month" | "all" | null
): Promise<string> {
  const now = new Date();
  const start = new Date();

  const effectiveTimeframe = timeframe || "month";

  switch (effectiveTimeframe) {
    case "week":
      start.setDate(now.getDate() - 7);
      break;
    case "15days":
      start.setDate(now.getDate() - 15);
      break;
    case "month":
      start.setMonth(now.getMonth() - 1);
      break;
    case "all":
      start.setFullYear(2000); // effectively all
      break;
  }

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      transactionType: "expense",
      occurredAt: { gte: start, lte: now },
    },
    orderBy: { occurredAt: "asc" },
  });

  if (transactions.length === 0) {
    return `No encontré gastos registrados en este periodo (${effectiveTimeframe}). ¡Parece que tus finanzas están intactas por ahora!`;
  }

  // Format transactions to a compact string to save tokens
  const formattedTxs = transactions
    .map((t) => {
      const date = t.occurredAt.toISOString().split("T")[0];
      const amount = (t.amountMinor / 100).toFixed(2);
      const cat = CATEGORY_LABELS[t.category] || t.category;
      return `[${date}] $${amount} - ${t.description || cat}`;
    })
    .join("\n");

  const total = transactions.reduce((acc, t) => acc + t.amountMinor, 0);
  const totalFmt = (total / 100).toFixed(2);

  const prompt = `
Eres un asesor financiero personal amigable pero directo. 
El usuario te pide un análisis de sus "gastos hormiga" o fugas de dinero recientes.
No le des un sermón largo. Sé súper conciso, como un mensaje de WhatsApp.

Aquí están sus gastos del periodo solicitado (Total gastado: $${totalFmt}):
${formattedTxs}

INSTRUCCIONES:
1. Identifica rápidamente patrones (ej. mucho gasto en Uber, cafés, Oxxo, cositas pequeñas).
2. Dile cuánto suman esos gastos hormiga (aproximado).
3. Dale UN consejo directo y amable sobre cómo reducir esa fuga específica.
4. Usa emojis. No uses bullet points excesivos ni texto muy largo (máximo 2-3 párrafos cortos).
`;

  try {
    logger.info({ userId, effectiveTimeframe, txCount: transactions.length }, "Requesting analysis from OpenAI");
    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const advice = response.choices[0]?.message?.content?.trim();
    if (!advice) {
      throw new Error("Empty response from AI");
    }

    return advice;
  } catch (error) {
    logger.error({ error }, "Error generating expenses analysis");
    return "Lo siento, tuve un problema analizando tus gastos en este momento. Inténtalo más tarde.";
  }
}

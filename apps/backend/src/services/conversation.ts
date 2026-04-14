import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { MAX_CONTEXT_MESSAGES } from "@finance/shared";

/**
 * Save a conversation message to the database.
 */
export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
  parseResult?: Prisma.InputJsonValue | null,
) {
  return prisma.conversationMessage.create({
    data: {
      userId,
      role,
      content,
      parseResult: parseResult ?? undefined,
    },
  });
}

/**
 * Get recent conversation messages for context (used by Claude parser).
 */
export async function getRecentMessages(userId: string) {
  const messages = await prisma.conversationMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_CONTEXT_MESSAGES,
    select: { role: true, content: true },
  });

  return messages.reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

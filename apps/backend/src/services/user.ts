import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * Extract a normalized phone number from a WhatsApp ID.
 * Formats: "5215551234567@c.us" → "+5215551234567"
 *          "230523964280877@lid" → stored as-is (LID format)
 */
export function extractPhone(waId: string): string {
  const raw = waId.split("@")[0];
  // If it looks like a phone number (all digits), prefix with +
  if (/^\d+$/.test(raw) && raw.length >= 10) {
    return `+${raw}`;
  }
  // LID format — store as-is for now
  return raw;
}

/**
 * Find or create a user by their WhatsApp ID.
 * Returns the user record.
 */
export async function findOrCreateUser(waId: string) {
  const phone = extractPhone(waId);

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  logger.debug({ userId: user.id, phone }, "User resolved");
  return user;
}

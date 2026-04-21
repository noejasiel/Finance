import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { normalizePhoneNumber } from "../lib/phone.js";

/**
 * Extract a normalized phone number from a WhatsApp ID.
 * Formats: "5215551234567@c.us" → "+5215551234567"
 *          "230523964280877@lid" → stored as-is (LID format)
 */
export function extractPhone(waId: string): string {
  const raw = waId.split("@")[0];
  return normalizePhoneNumber(raw);
}

/**
 * Find or create a user by their WhatsApp ID.
 * Returns the user record including onboardingStep.
 */
export async function findOrCreateUser(waId: string) {
  const phone = extractPhone(waId);

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  logger.debug({ userId: user.id, phone, onboardingStep: user.onboardingStep }, "User resolved");
  return user;
}

/**
 * Set the user's name and mark onboarding as done.
 */
export async function completeOnboarding(userId: string, name: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { name, onboardingStep: "done" },
  });
}

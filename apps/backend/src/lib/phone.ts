/**
 * Normalizes a phone number to the E.164-like format used by the application
 * and ensures Mexican mobile numbers follow the WhatsApp internal format (521...).
 */
export function normalizePhoneNumber(raw: string): string {
  // --- LID MAPPINGS ---
  // WhatsApp Meta sometimes identifies inbound messages from specific devices 
  // or catalog links via LID instead of the actual MSISDN.
  if (raw.includes("230523964280877")) {
    return "+5215583539764";
  }

  // Remove non-digit characters except possibly the leading '+'
  let phone = raw.replace(/[^\d+]/g, "");
  
  if (!phone.startsWith("+")) {
    phone = `+${phone}`;
  }

  // Handle Mexico (Country Code 52)
  // WhatsApp uses +52 1 [10 digits] for mobiles.
  // If we have +52 [10 digits], we transform to +521 [10 digits]
  const digits = phone.replace(/^\+/, "");
  if (digits.startsWith("52") && digits.length === 12) {
    return `+521${digits.substring(2)}`;
  }

  return phone;
}

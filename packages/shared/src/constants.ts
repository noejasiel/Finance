/** Default currency when not specified */
export const DEFAULT_CURRENCY = "MXN" as const;

/** Default timezone fallback */
export const DEFAULT_TIMEZONE = "America/Mexico_City";

/** OTP code length */
export const OTP_LENGTH = 6;

/** OTP expiration in minutes */
export const OTP_EXPIRY_MINUTES = 5;

/** Max recent messages for Claude context */
export const MAX_CONTEXT_MESSAGES = 10;

/** Confidence threshold below which we ask for confirmation */
export const CONFIDENCE_THRESHOLD = 0.7;

/** Category limit alert thresholds */
export const ALERT_THRESHOLDS = [0.8, 1.0] as const;

/** Session cookie name */
export const SESSION_COOKIE = "finance_session";

/** API version prefix */
export const API_PREFIX = "/api/v1";

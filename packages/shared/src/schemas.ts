import { z } from "zod";

// ── Currency & Money ──────────────────────────────────────────────
export const CurrencySchema = z.enum(["MXN", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

// ── Transaction Types ─────────────────────────────────────────────
export const TransactionTypeSchema = z.enum(["expense", "income"]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

// ── Categories ────────────────────────────────────────────────────
export const CategorySchema = z.enum([
  "food",
  "transport",
  "entertainment",
  "health",
  "shopping",
  "services",
  "housing",
  "education",
  "travel",
  "salary",
  "freelance",
  "gift",
  "investment",
  "other",
]);
export type Category = z.infer<typeof CategorySchema>;

// ── Intent (what Claude understood) ───────────────────────────────
export const IntentSchema = z.enum([
  "log_transaction",
  "delete_last",
  "correct_last",
  "monthly_summary",
  "category_summary",
  "set_alert",
  "help",
  "greeting",
  "unknown",
]);
export type Intent = z.infer<typeof IntentSchema>;

// ── Claude Parser Output ──────────────────────────────────────────
export const ParseResultSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  amount_minor: z.number().int().nonnegative().nullable(),
  currency: CurrencySchema.default("MXN"),
  transaction_type: TransactionTypeSchema.nullable(),
  category: CategorySchema.nullable(),
  description: z.string().nullable(),
  occurred_at: z.string().datetime({ offset: true }).nullable(),
  needs_confirmation: z.boolean(),
  correction: z
    .object({
      field: z.string(),
      new_value: z.string(),
    })
    .nullable()
    .default(null),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;

// ── API Request / Response Schemas ────────────────────────────────

export const RequestCodeSchema = z.object({
  phone: z
    .string()
    .min(10)
    .max(15)
    .regex(/^\+?\d+$/, "Phone must contain only digits and optional leading +"),
});

export const VerifyCodeSchema = z.object({
  phone: z
    .string()
    .min(10)
    .max(15)
    .regex(/^\+?\d+$/),
  code: z.string().length(6).regex(/^\d+$/, "Code must be 6 digits"),
});

export const PatchTransactionSchema = z.object({
  amount_minor: z.number().int().positive().optional(),
  currency: CurrencySchema.optional(),
  transaction_type: TransactionTypeSchema.optional(),
  category: CategorySchema.optional(),
  description: z.string().min(1).max(500).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
});
export type PatchTransaction = z.infer<typeof PatchTransactionSchema>;

export const TransactionsQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  category: CategorySchema.optional(),
  type: TransactionTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ── Alert Rules ───────────────────────────────────────────────────
export const AlertTypeSchema = z.enum([
  "category_limit",
  "negative_balance",
  "unusual_expense",
  "weekly_summary",
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertRuleSchema = z.object({
  type: AlertTypeSchema,
  enabled: z.boolean(),
  category: CategorySchema.nullable().default(null),
  threshold_minor: z.number().int().nonnegative().nullable().default(null),
  day_of_week: z.number().int().min(0).max(6).nullable().default(null),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const UpsertAlertsSchema = z.object({
  rules: z.array(AlertRuleSchema).min(1).max(20),
});

// ── API Response Envelope ─────────────────────────────────────────
export const ApiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    ok: z.literal(true),
    data: data,
  });

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

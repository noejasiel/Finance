import type {
  AlertRule,
  AlertType,
  Category,
  Currency,
  ParseResult,
  TransactionType,
} from "./schemas.js";

// ── Domain Types ──────────────────────────────────────────────────

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  onboarding_step: "name" | "done";
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  amount_minor: number;
  currency: Currency;
  transaction_type: TransactionType;
  category: Category;
  description: string | null;
  occurred_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  parse_result: ParseResult | null;
  created_at: string;
}

export interface AlertRuleRow {
  id: string;
  user_id: string;
  type: AlertType;
  enabled: boolean;
  category: Category | null;
  threshold_minor: number | null;
  day_of_week: number | null;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: string;
  user_id: string;
  rule_id: string;
  message: string;
  sent_at: string;
}

export interface LoginChallenge {
  id: string;
  phone: string;
  code: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

// ── API Response Types ────────────────────────────────────────────

export interface DashboardMonth {
  month: string;
  total_expenses: number;
  total_income: number;
  balance: number;
  currency: Currency;
  by_category: Array<{
    category: Category;
    total: number;
  }>;
  weekly_trend: Array<{
    week: number;
    expenses: number;
    income: number;
  }>;
  top_expenses: Array<{
    description: string | null;
    amount_minor: number;
    category: Category;
    occurred_at: string;
  }>;
  comparison: {
    prev_expenses: number;
    prev_income: number;
    expense_delta_pct: number | null;
    income_delta_pct: number | null;
  };
}

export interface AlertConfig {
  rules: AlertRule[];
}

export interface MeResponse {
  user: User;
}

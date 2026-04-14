import { config } from "dotenv";
import { z } from "zod";

config();
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  INTERNAL_API_TOKEN: z.string().min(16),
  APP_URL: z.string().url().default("http://localhost:3000"),
  WA_AUTH_STRATEGY: z.enum(["local", "remote"]).default("local"),
  WA_ALLOWED_IDS: z.string().default(""), // comma-separated WhatsApp IDs allowed during dev
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function env(): Env {
  if (!_env) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}

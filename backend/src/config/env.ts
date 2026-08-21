import "dotenv/config";
import { z } from "zod";

/**
 * Every piece of configuration the API needs, validated once at boot.
 *
 * Secrets (Mongo URI, JWT secrets) are never defaulted in production — the
 * process refuses to start instead of silently running on a well-known value.
 */
const booleanish = z
  .string()
  .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default("/api/v1"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  /** Comma-separated list of origins allowed to call the API with credentials. */
  CORS_ORIGINS: z.string().default("http://localhost:8080"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanish.optional(),

  /** Where uploaded shop images are written, relative to the backend package root. */
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /** Signing key for short-lived file URLs; falls back to the access secret. */
  FILE_URL_SECRET: z.string().optional(),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),

  /** Seed / migration inputs. */
  ADMIN_EMAIL: z.string().email().default("noobgaming2907@gmail.com"),
  ADMIN_PASSWORD: z.string().min(8).default("Dipak@123"),
  ADMIN_FULL_NAME: z.string().default("Klinzo Administrator"),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  // Tests spin up an in-memory MongoDB and inject their own secrets; give them
  // safe throwaway defaults so no .env file is needed to run the suite.
  if (process.env.NODE_ENV === "test") {
    process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/klinzo_test";
    process.env.JWT_ACCESS_SECRET ??= "test-access-secret-value-0123456789";
    process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-value-0123456789";
  }

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid backend environment configuration:\n${details}\n\nSee backend/.env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

export const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const fileUrlSecret = env.FILE_URL_SECRET ?? env.JWT_ACCESS_SECRET;

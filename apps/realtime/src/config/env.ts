import { z } from "zod";

const commaList = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

// Only what the live service needs: no session, email or storage secrets.
const RealtimeEnv = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3020),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:16379"),
  // The same secret the API signs passes with.
  LIVE_TICKET_SECRET: z
    .string()
    .min(32, "LIVE_TICKET_SECRET must be at least 32 characters"),
  // Browser pages allowed to connect. Apps send no Origin and are allowed.
  TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:8081")
    .transform(commaList),
  LIVE_BEAT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  LIVE_RECHECK_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(3_600_000)
    .default(300_000),
  LIVE_MAX_PER_USER: z.coerce.number().int().min(1).max(50).default(5),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});
export type RealtimeEnv = z.infer<typeof RealtimeEnv>;

export function readRealtimeEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = RealtimeEnv.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid live service settings: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`,
    );
  const env = result.data;
  if (env.NODE_ENV === "production") {
    if (
      env.TRUSTED_ORIGINS.some(
        (origin) => origin !== "hisaab://" && !origin.startsWith("https://"),
      )
    )
      throw new Error("TRUSTED_ORIGINS must be HTTPS origins in production.");
    if (/change-me|replace-me|example-secret/i.test(env.LIVE_TICKET_SECRET))
      throw new Error("Replace the example LIVE_TICKET_SECRET.");
  }
  return env;
}

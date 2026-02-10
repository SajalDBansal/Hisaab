import { z } from "zod";

const WorkerEnv = z.object({
  APP_MODE: z.enum(["normal", "recovery"]).default("normal"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:16379"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3011),
  PDF_BROWSER_PATH: z.string().optional(),
  AWS_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_ENDPOINT: z.union([z.url(), z.literal("")]).optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

// Only worker-owned settings are parsed; API session and email secrets are unnecessary.
export function readWorkerEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = WorkerEnv.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid worker settings: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const env = result.data;
  if (env.APP_MODE === "recovery")
    throw new Error("Background workers are disabled in recovery mode.");
  const r2 = [
    env.R2_ACCOUNT_ID,
    env.R2_BUCKET,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
  ];
  if (r2.some(Boolean) && !r2.every(Boolean))
    throw new Error(
      "Set all four R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY values.",
    );
  if (env.NODE_ENV === "production") {
    if (!env.PDF_BROWSER_PATH)
      throw new Error(
        "PDF_BROWSER_PATH is required for the production worker.",
      );
    if (!env.R2_BUCKET && !env.S3_BUCKET)
      throw new Error(
        "Private R2_BUCKET (or S3_BUCKET) is required in production.",
      );
    if (env.R2_ENDPOINT) {
      const endpoint = new URL(env.R2_ENDPOINT);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.origin !== env.R2_ENDPOINT.replace(/\/$/, "")
      )
        throw new Error("R2_ENDPOINT must be an HTTPS origin in production.");
    }
  }
  return env;
}

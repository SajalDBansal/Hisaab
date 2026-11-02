import { z } from "zod";
import { isIP } from "node:net";
import { recoveryEpoch } from "../plugins/recovery";
import { RecoveryEpoch } from "@repo/contracts";

const commaList = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function isProxyAddress(value: string) {
  const [address, prefix, extra] = value.split("/");
  const version = isIP(address ?? "");
  if (!version || extra !== undefined) return false;
  return (
    prefix === undefined ||
    (/^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128))
  );
}

// Every setting the server reads comes through here. A missing or wrong value
// stops the server at start-up with a clear message, not later in the middle of a request.
const EnvSchema = z.object({
  APP_MODE: z.enum(["normal", "recovery"]).default("normal"),
  RECOVERY_EPOCH: RecoveryEpoch.optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Trust forwarding headers only from explicitly named reverse proxies.
  TRUSTED_PROXY_CIDRS: z
    .string()
    .default("")
    .transform(commaList)
    .refine(
      (values) => values.every(isProxyAddress),
      "Use comma-separated proxy IP addresses or CIDRs, never '*'.",
    ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (see .env.example)"),

  // Redis for rate limits and background jobs.
  REDIS_URL: z.string().default("redis://localhost:16379"),

  // Signs session cookies and hashes codes. Make one with: openssl rand -base64 32
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  // The public address of this API, e.g. https://api.hisaab.in
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  // Websites and app schemes allowed to call the API, separated by commas
  TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:8081,hisaab://")
    .transform(commaList),

  // Without a Resend key, codes are printed in the server log instead of emailed (development only)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Hisaab <onboarding@resend.dev>"),

  // Private S3 bucket for uploaded documents and server-rendered files
  AWS_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_ENDPOINT: z.union([z.url(), z.literal("")]).optional(),
  DOCUMENT_STORAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(1024 ** 3),
  DOCUMENT_STORAGE_MAX_FILES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(10_000),

  // Optional Sentry exporter. Leave blank locally; set in staging/production.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type Env = Omit<z.infer<typeof EnvSchema>, "RECOVERY_EPOCH"> & {
  RECOVERY_EPOCH: string;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  if (
    result.data.NODE_ENV === "production" &&
    result.data.APP_MODE === "normal" &&
    !result.data.RESEND_API_KEY
  )
    throw new Error(
      "RESEND_API_KEY is required in production, or nobody can sign up.",
    );
  const env: Env = {
    ...result.data,
    RECOVERY_EPOCH: recoveryEpoch(
      result.data.RECOVERY_EPOCH,
      result.data.NODE_ENV === "production",
    ),
  };
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
  if (
    env.NODE_ENV === "production" &&
    env.APP_MODE === "normal" &&
    !env.S3_BUCKET &&
    !env.R2_BUCKET
  )
    throw new Error("R2_BUCKET (or S3_BUCKET) is required in production.");
  if (env.NODE_ENV === "production") validateProduction(env);
  return env;
}

function exactHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && value === url.origin && !value.includes("*")
    );
  } catch {
    return false;
  }
}

// Reject insecure deployment settings without including their values in errors.
function validateProduction(env: Env) {
  if (!exactHttpsOrigin(env.BETTER_AUTH_URL))
    throw new Error(
      "BETTER_AUTH_URL must be an exact HTTPS API origin in production.",
    );
  if (
    !env.TRUSTED_ORIGINS.length ||
    env.TRUSTED_ORIGINS.some(
      (origin) => origin !== "hisaab://" && !exactHttpsOrigin(origin),
    )
  )
    throw new Error(
      "TRUSTED_ORIGINS must contain exact HTTPS origins or hisaab:// in production.",
    );
  if (/change-me|replace-me|example-secret/i.test(env.BETTER_AUTH_SECRET))
    throw new Error(
      "Replace the example BETTER_AUTH_SECRET before production.",
    );
  if (env.APP_MODE === "normal" && env.EMAIL_FROM.includes("@resend.dev"))
    throw new Error(
      "EMAIL_FROM must use your verified sender domain in production.",
    );
  if (env.R2_ENDPOINT && !exactHttpsOrigin(env.R2_ENDPOINT.replace(/\/$/, "")))
    throw new Error("R2_ENDPOINT must use an HTTPS origin in production.");
}

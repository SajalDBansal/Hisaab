import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env";
import { RECOVERY_EPOCH_HEADER } from "@repo/contracts";

type SecurityEnv = Pick<Env, "NODE_ENV" | "TRUSTED_ORIGINS">;

function webOrigins(origins: string[]) {
  return origins.filter((origin) => origin.startsWith("http"));
}

/** Browser-facing safety headers and a tight CORS allow-list. */
export async function registerSecurity(app: FastifyInstance, env: SecurityEnv) {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
    hsts:
      env.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
  });

  await app.register(cors, {
    origin: webOrigins(env.TRUSTED_ORIGINS),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-firm-id",
      "x-platform",
      "x-device-name",
      "x-confirm-takeover",
      "idempotency-key",
      "if-match",
      "if-none-match",
      "x-request-id",
      RECOVERY_EPOCH_HEADER,
      "expo-origin",
      "cookie",
    ],
    exposedHeaders: [
      "x-request-id",
      "set-auth-token",
      "retry-after",
      "etag",
      RECOVERY_EPOCH_HEADER,
    ],
  });
}

import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  RECOVERY_REQUIRED,
  RecoveryEpoch,
} from "@repo/contracts";
import { AppError } from "@repo/backend/lib/app-error";
import type { FastifyInstance, FastifyRequest } from "fastify";

// The epoch lives outside PostgreSQL so restoring an older database cannot rewind it.
export function recoveryEpoch(value: string | undefined, production: boolean) {
  const epoch = RecoveryEpoch.parse(value ?? DEVELOPMENT_RECOVERY_EPOCH);
  if (production && epoch === DEVELOPMENT_RECOVERY_EPOCH)
    throw new Error(
      "Set a unique RECOVERY_EPOCH UUID in production configuration.",
    );
  return epoch;
}

function requiresEpoch(request: FastifyRequest) {
  const route = request.routeOptions.url ?? "";
  if (route.startsWith("/v1/operations/")) return true;
  if (route === "/v1/sync/push") return true;
  if (route === "/v1/sync/changes") {
    const query = new URL(request.url, "http://localhost").searchParams;
    return Number(query.get("since") ?? 0) > 0;
  }
  return (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    route.startsWith("/v1/") &&
    request.headers["idempotency-key"] !== undefined
  );
}

// Check retries before route handlers, transaction work or saved-answer lookup can run.
export function registerRecoveryEpoch(app: FastifyInstance, epoch: string) {
  app.addHook("onSend", async (_request, reply) => {
    reply.header(RECOVERY_EPOCH_HEADER, epoch);
  });
  app.addHook("onRequest", async (request) => {
    if (request.method === "OPTIONS") return;
    const header = request.headers[RECOVERY_EPOCH_HEADER];
    const mutation =
      !["GET", "HEAD"].includes(request.method) &&
      (request.routeOptions.url ?? "").startsWith("/v1/");
    if (!requiresEpoch(request) && !(mutation && header !== undefined)) return;
    const received = RecoveryEpoch.safeParse(header);
    if (!received.success || received.data !== epoch)
      throw new AppError(
        RECOVERY_REQUIRED,
        "The saved request belongs to an unknown or earlier recovery point. Keep pending entries and attachments, then reconcile them before retrying. Signing in again does not resolve this.",
        409,
      );
  });
}

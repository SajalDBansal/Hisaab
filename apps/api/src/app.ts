import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import compress from "@fastify/compress";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { createAuth } from "./auth/auth";
import type { Env } from "./config/env";
import type { Db } from "@repo/backend/db/client";
import type { JobQueueClient } from "@repo/backend/jobs/queues";
import type { EmailSender } from "./lib/email";
import { createErrorReporter } from "@repo/backend/lib/observability";
import { safeError } from "@repo/backend/lib/safe-error";
import type { RedisClient } from "@repo/backend/lib/redis";
import { fakeStorage, type FileStorage } from "./lib/storage";
import { accountRoutes } from "./modules/accounts/accounts.routes";
import { backupRoutes } from "./modules/backup/backup.routes";
import { firmRoutes } from "./modules/firms/firms.routes";
import { gstRoutes } from "./modules/gst/gst.routes";
import { documentRoutes } from "./modules/documents/documents.routes";
import { itemRoutes } from "./modules/masters/items.routes";
import { ledgerRoutes } from "./modules/masters/ledgers.routes";
import { notificationRoutes } from "./modules/notifications/notifications.routes";
import { reportRoutes } from "./modules/reports/reports.routes";
import { searchRoutes } from "./modules/search/search.routes";
import { syncRoutes } from "./modules/sync/sync.routes";
import { voucherRoutes } from "./modules/vouchers/vouchers.routes";
import { partyRoutes } from "./modules/masters/parties.routes";
import { meRoutes } from "./modules/me/me.routes";
import { registerAuth } from "./plugins/auth";
import { registerCacheHelpers } from "./plugins/cache";
import { registerFirmContext } from "./plugins/firm";
import { systemRoutes, type ReadyCheck } from "./modules/system/system.routes";
import { registerErrorHandling } from "./plugins/errors";
import { registerJobs } from "./plugins/jobs";
import { registerObservability } from "./plugins/observability";
import { registerRateLimits } from "./plugins/rate-limit";
import { registerSecurity } from "./plugins/security";
import { registerSwagger } from "./plugins/swagger";
import { settingsRoutes } from "./modules/settings/settings.routes";
import { auditRoutes } from "./modules/settings/audit.routes";
import { bookControlRoutes } from "./modules/settings/bookControls";
import { openingAllocationRoutes } from "./modules/settings/openingAllocations";
import { yearEndRoutes } from "./modules/settings/yearEnd";
import { importRoutes } from "./modules/imports/imports.routes";
import { loanRoutes } from "./modules/loans/loans.routes";
import { inventoryRoutes } from "./modules/inventory/inventory.routes";
import { settlementRoutes } from "./modules/settlements/settlements.routes";
import { associateRoutes } from "./modules/associates/associates.routes";
import { orderFulfillmentRoutes } from "./modules/order-fulfillment/orderFulfillment.routes";
import { orderFulfillmentHooks } from "./modules/order-fulfillment/orderFulfillment.hooks";
import { operationRoutes } from "./modules/operations/operations.routes";
import { recoveryOperationsRoutes } from "./modules/recovery-operations/recovery-operations.routes";
import { cashForecastRoutes } from "./modules/reports/cashForecast";
import { reminderRoutes } from "./modules/reminders/reminders.routes";
import type { PdfStorage } from "@repo/backend/modules/server-pdf/storage";
import { recoveryEpoch, registerRecoveryEpoch } from "./plugins/recovery";

export type BuildAppOptions = {
  env: Pick<
    Env,
    | "NODE_ENV"
    | "LOG_LEVEL"
    | "BETTER_AUTH_SECRET"
    | "BETTER_AUTH_URL"
    | "TRUSTED_ORIGINS"
    | "SENTRY_DSN"
    | "SENTRY_ENVIRONMENT"
    | "SENTRY_RELEASE"
    | "SENTRY_TRACES_SAMPLE_RATE"
  > &
    Partial<
      Pick<
        Env,
        | "TRUSTED_PROXY_CIDRS"
        | "DOCUMENT_STORAGE_MAX_BYTES"
        | "DOCUMENT_STORAGE_MAX_FILES"
        | "APP_MODE"
        | "RECOVERY_EPOCH"
      >
    >;
  db: Db;
  /** Sends the 6-digit codes: Resend in production, the log or memory in development and tests. */
  email: EmailSender;
  redis?: RedisClient;
  jobs?: JobQueueClient;
  storage?: FileStorage;
  pdfStorage?: PdfStorage;
  /** Database and Redis checks are added here from step 2 on. */
  readyChecks?: ReadyCheck[];
};

/** Builds the app without starting it, so tests can call it with `app.inject()`. */
export async function buildApp({
  env,
  db,
  email,
  redis,
  jobs,
  storage = fakeStorage(),
  pdfStorage,
  readyChecks = [],
}: BuildAppOptions) {
  const app = Fastify({
    trustProxy: env.TRUSTED_PROXY_CIDRS?.length
      ? env.TRUSTED_PROXY_CIDRS
      : false,
    logger: {
      level: env.LOG_LEVEL,
      serializers: { err: safeError },
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['set-cookie']",
        "res.headers['set-cookie']",
      ],
      // Readable lines while developing, JSON lines in production
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : {}),
    },
    // Reuse the caller's id if it sends one, so one request can be followed end to end
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // A stalled connection should not hold a server slot forever
    connectionTimeout: 30_000,
    bodyLimit: 1_048_576,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  registerErrorHandling(app);
  registerRecoveryEpoch(
    app,
    recoveryEpoch(env.RECOVERY_EPOCH, env.NODE_ENV === "production"),
  );
  await registerSecurity(app, env);
  await app.register(compress, { global: true, threshold: 1024 });
  await registerRateLimits(app, redis);
  const reporter = createErrorReporter(app.log, {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "api",
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
  registerObservability(app, reporter);
  // Recovery is a separate surface: no sessions, business routes, queues or storage writes.
  if (env.APP_MODE === "recovery") {
    await app.register(systemRoutes, { readyChecks });
    await app.register(recoveryOperationsRoutes, { db, prefix: "/v1" });
    return app;
  }
  registerJobs(app, jobs);
  app.addHook("onClose", async () => pdfStorage?.close());
  registerCacheHelpers(app, redis);
  if (env.NODE_ENV !== "production") await registerSwagger(app);
  const auth = createAuth({ env, db, email, log: app.log });
  await registerAuth(app, auth, db);

  registerFirmContext(app, db);

  await app.register(systemRoutes, { readyChecks });
  await app.register(meRoutes, { db, prefix: "/v1" });
  await app.register(firmRoutes, { db, auth, prefix: "/v1" });
  await app.register(partyRoutes, { db, prefix: "/v1" });
  await app.register(itemRoutes, { db, prefix: "/v1" });
  await app.register(ledgerRoutes, { db, prefix: "/v1" });
  await app.register(voucherRoutes, { db, pdfStorage, prefix: "/v1" });
  await app.register(accountRoutes, { db, prefix: "/v1" });
  await app.register(reportRoutes, { db, prefix: "/v1" });
  await app.register(gstRoutes, { db, prefix: "/v1" });
  await app.register(settingsRoutes, { db, prefix: "/v1" });
  await app.register(auditRoutes, { db, prefix: "/v1" });
  await app.register(bookControlRoutes, { db, prefix: "/v1" });
  await app.register(openingAllocationRoutes, { db, prefix: "/v1" });
  await app.register(yearEndRoutes, { db, prefix: "/v1" });
  await app.register(importRoutes, {
    db,
    parseCsv,
    previewSecret: env.BETTER_AUTH_SECRET,
    prefix: "/v1",
  });
  await app.register(loanRoutes, { db, prefix: "/v1" });
  await app.register(inventoryRoutes, { db, prefix: "/v1" });
  await app.register(settlementRoutes, { db, prefix: "/v1" });
  await app.register(associateRoutes, { db, prefix: "/v1" });
  await app.register(orderFulfillmentRoutes, {
    db,
    hooks: orderFulfillmentHooks,
    prefix: "/v1",
  });
  await app.register(operationRoutes, { db, prefix: "/v1" });
  await app.register(cashForecastRoutes, { db, prefix: "/v1" });
  await app.register(backupRoutes, { db, prefix: "/v1" });
  await app.register(reminderRoutes, { db, prefix: "/v1" });
  await app.register(documentRoutes, {
    db,
    storage,
    prefix: "/v1",
    limits: {
      maxBytes: env.DOCUMENT_STORAGE_MAX_BYTES,
      maxFiles: env.DOCUMENT_STORAGE_MAX_FILES,
    },
  });
  await app.register(searchRoutes, { db, prefix: "/v1" });
  await app.register(notificationRoutes, { db, prefix: "/v1" });
  await app.register(syncRoutes, { db, prefix: "/v1" });

  return app;
}

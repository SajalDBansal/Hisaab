import Fastify from "fastify";
import { access } from "node:fs/promises";
import { readWorkerEnv } from "./config/env";
import { startHealthServer, within } from "./health";
import { createDb, createReadinessPool } from "@repo/backend/db/client";
import { createJobRedis } from "@repo/backend/lib/redis";
import { closeJobWorkers, createJobWorkers } from "./jobs/workers";
import { createBullJobs } from "@repo/backend/jobs/queues";
import { scheduleRecurringJobs } from "@repo/backend/jobs/schedule";
import { createPdfStorage } from "@repo/backend/modules/server-pdf/storage";
import { createPdfRenderer } from "./pdf/renderer";
import { backupEnabled, readBackupConfig } from "./backup/config";
import { createBackupService } from "./backup/runner";
import { createDocumentCleanupStorage } from "@repo/backend/modules/documents/cleanup-storage";
import { safeError } from "@repo/backend/lib/safe-error";
import {
  createErrorReporter,
  installProcessErrorHandlers,
} from "@repo/backend/lib/observability";

const env = readWorkerEnv();
const browserPath = env.PDF_BROWSER_PATH;
if (browserPath) await access(browserPath);
const { db, pool } = createDb(env.DATABASE_URL, {
  max: 4,
  connectionTimeoutMillis: 5_000,
});
const readinessPool = createReadinessPool(env.DATABASE_URL);
const redis = createJobRedis(env.REDIS_URL);
// Probe limits must never affect BullMQ's blocking/retry connections.
const readinessRedis = redis.duplicate({
  lazyConnect: false,
  commandTimeout: 1_000,
  socketTimeout: 1_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});
const log = Fastify({ logger: { level: env.LOG_LEVEL, serializers: { err: safeError } } }).log;
readinessPool.on("error", () => {
  log.warn({ check: "database" }, "Readiness connection failed");
});
readinessRedis.on("error", () => {
  log.warn({ check: "redis" }, "Readiness connection failed");
});
installProcessErrorHandlers(
  log,
  "worker",
  createErrorReporter(log, {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "worker",
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  }),
);

const jobs = createBullJobs(redis);
const storage = createPdfStorage(env);
const documentStorage = createDocumentCleanupStorage(env);
const shutdown = new AbortController();
const backup = backupEnabled()
  ? createBackupService(readBackupConfig(), log)
  : undefined;
if (!browserPath)
  log.warn(
    "PDF_BROWSER_PATH is not configured; PDF jobs will fail explicitly.",
  );
const workers = createJobWorkers(redis, {
  db,
  log,
  redis,
  jobs,
  backup,
  documentStorage,
  signal: shutdown.signal,
  pdf: browserPath
    ? { storage, render: createPdfRenderer(browserPath) }
    : undefined,
});
let shuttingDown = false;
let started = false;
const health = await startHealthServer(env.WORKER_HEALTH_PORT, async () => {
  if (
    !started ||
    shuttingDown ||
    redis.status !== "ready" ||
    workers.some((worker) => !worker.isRunning())
  )
    return false;
  await Promise.all([readinessPool.query("select 1"), readinessRedis.ping()]);
  return true;
}).catch((err) => {
  log.error({ err }, "Worker health listener could not start");
  process.exit(1);
});

async function shutDown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdown.abort();
  backup?.abort();
  log.info({ signal }, "Shutting down worker");
  // Leave the runtime time to stop us; interrupted idempotent jobs can be retried after exit.
  const deadline = setTimeout(() => process.exit(1), 60_000);
  deadline.unref();
  try {
    health.close();
    readinessRedis.disconnect();
    await readinessPool.end();
    await closeJobWorkers(workers);
    await backup?.close();
    await jobs.close();
    storage.close();
    documentStorage.close();
    redis.disconnect();
    await pool.end();
    process.exit(exitCode);
  } catch (err) {
    log.error({ err }, "Worker shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutDown("SIGTERM"));
process.on("SIGINT", () => void shutDown("SIGINT"));

try {
  await within(
    Promise.all(workers.map((worker) => worker.waitUntilReady())),
    20_000,
  );
  await within(scheduleRecurringJobs(jobs, !!backup), 10_000);
  await Promise.all([readinessPool.query("select 1"), readinessRedis.ping()]);
  started = true;
} catch (err) {
  log.error({ err }, "Worker startup failed");
  await shutDown("startup-failed", 1);
}

log.info(
  { queues: workers.map((worker) => worker.name) },
  "Background worker started",
);

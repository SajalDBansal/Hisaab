import { buildApp } from "./app";
import { readEnv } from "./config/env";
import { createDb } from "@repo/backend/db/client";
import { createBullJobs } from "@repo/backend/jobs/queues";
import { logSender, resendSender } from "./lib/email";
import {
  createErrorReporter,
  installProcessErrorHandlers,
} from "@repo/backend/lib/observability";
import { createQueueRedis, createRedis } from "@repo/backend/lib/redis";
import { createS3Storage } from "./lib/storage";
import { createPdfStorage } from "@repo/backend/modules/server-pdf/storage";

const env = readEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const recovery = env.APP_MODE === "recovery";
const noRecoveryEmail = async () => {
  throw new Error("Email is disabled during isolated recovery.");
};
const jobRedis = recovery ? undefined : createQueueRedis(env.REDIS_URL);
const jobs = jobRedis ? createBullJobs(jobRedis) : undefined;
const storage = recovery
  ? undefined
  : createS3Storage({
      bucket: env.R2_BUCKET || env.S3_BUCKET,
      region: env.R2_BUCKET ? "auto" : env.AWS_REGION,
      endpoint: env.R2_BUCKET
        ? env.R2_ENDPOINT ||
          `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined,
      credentials:
        env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.R2_ACCESS_KEY_ID,
              secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            }
          : undefined,
    });

const app = await buildApp({
  env,
  db,
  redis,
  jobs,
  storage,
  pdfStorage: recovery ? undefined : createPdfStorage(env),
  email: recovery
    ? { sendCode: noRecoveryEmail, sendInvite: noRecoveryEmail }
    : env.RESEND_API_KEY
      ? resendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
      : logSender((message) => app.log.warn(message)),
  readyChecks: [
    { name: "database", run: async () => void (await pool.query("select 1")) },
    { name: "redis", run: async () => void (await redis.ping()) },
  ],
});
installProcessErrorHandlers(
  app.log,
  "api",
  createErrorReporter(app.log, {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "api",
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  }),
);

// Stop taking new requests, let running ones finish, then exit.
async function shutDown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  try {
    await app.close();
    redis.disconnect();
    jobRedis?.disconnect();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Shutdown failed");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutDown("SIGTERM"));
process.on("SIGINT", () => void shutDown("SIGINT"));

await app.listen({ host: env.HOST, port: env.PORT });

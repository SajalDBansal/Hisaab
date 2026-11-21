import Fastify from "fastify";
import { createDb, createReadinessPool } from "@repo/backend/db/client";
import { createRedis } from "@repo/backend/lib/redis";
import { safeError } from "@repo/backend/lib/safe-error";
import {
  createErrorReporter,
  installProcessErrorHandlers,
} from "@repo/backend/lib/observability";
import { readRealtimeEnv } from "./config/env";
import { listenLive } from "./bus";
import { createLiveHub } from "./hub";

const env = readRealtimeEnv();
const app = Fastify({
  logger: { level: env.LOG_LEVEL, serializers: { err: safeError } },
  // Sockets stay open for hours; only plain HTTP requests get the timeout.
  connectionTimeout: 0,
});
installProcessErrorHandlers(
  app.log,
  "realtime",
  createErrorReporter(app.log, {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    service: "realtime",
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  }),
);

const { db, pool } = createDb(env.DATABASE_URL, {
  max: 4,
  connectionTimeoutMillis: 5_000,
});
const readinessPool = createReadinessPool(env.DATABASE_URL);
readinessPool.on("error", () => undefined);
const redis = createRedis(env.REDIS_URL);
redis.on("error", () => undefined);
await redis.connect().catch(() => undefined);

const hub = createLiveHub({
  db,
  redis,
  secret: env.LIVE_TICKET_SECRET,
  log: app.log,
  trustedOrigins: env.TRUSTED_ORIGINS,
  beatMs: env.LIVE_BEAT_MS,
  recheckMs: env.LIVE_RECHECK_MS,
  maxPerUser: env.LIVE_MAX_PER_USER,
});
const bus = listenLive({
  databaseUrl: env.DATABASE_URL,
  log: app.log,
  onEvent: hub.onEvent,
  onRestored: hub.resyncAll,
});

app.get("/health", async () => ({ status: "ok" }));
app.get("/ready", async (_req, reply) => {
  let ready = bus.listening() && redis.status === "ready";
  if (ready)
    try {
      await readinessPool.query("select 1");
      await redis.ping();
    } catch {
      ready = false;
    }
  reply.header("cache-control", "no-store").code(ready ? 200 : 503);
  return { status: ready ? "ready" : "unavailable", connections: hub.size() };
});
app.server.on("upgrade", hub.handleUpgrade);

await app.listen({ host: env.HOST, port: env.PORT });

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "Live service stopping");
  await hub.close();
  await bus.close();
  await app.close();
  await Promise.allSettled([redis.quit(), pool.end(), readinessPool.end()]);
  process.exit(0);
}
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));

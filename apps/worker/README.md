# Hisaab Worker

This is a standalone application, not a Fastify API route or an API startup hook.
It connects to the same PostgreSQL, Redis and private R2/S3 bucket as `apps/api`.
Run and scale it separately. Starting the API never starts a worker.

## Layout

| File                    | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `src/worker.ts`         | Validate configuration, start consumers/schedulers, drain on shutdown |
| `src/config/env.ts`     | Worker-only settings; no API session or Resend secret                 |
| `src/jobs/workers.ts`   | One BullMQ consumer per supported queue, concurrency one each         |
| `src/jobs/handlers.ts`  | Dispatch typed jobs to small handlers                                 |
| `src/jobs/reminders.ts` | Prepare due-reminder snapshots without sending messages               |
| `src/pdf/renderer.ts`   | Sandboxed, network-blocked Chromium PDF rendering                     |
| `src/health.ts`         | Loopback readiness; process, consumers, Redis state and DB            |
| `src/healthcheck.ts`    | Readiness client with a bounded timeout                               |

Shared queue payloads, database tables, PDF storage and accounting readers live
in `@repo/backend`. The worker never imports `apps/api/src`.

## Commands

Copy `apps/worker/.env.example` to `apps/worker/.env` and fill the same external
DB, Redis and private storage settings used by the API. Provision development
PostgreSQL and Redis separately. Configure
`PDF_BROWSER_PATH` to a local Chromium/Edge executable for PDF rendering.
Production requires it.

```sh
bun run --cwd apps/worker dev
bun run --cwd apps/worker build
bun run --cwd apps/worker start
bun run --cwd apps/worker healthcheck
```

Development does not load `apps/api/.env`. Without a local browser path, the
worker can prepare reminders/cleanup but PDF jobs fail explicitly. Production
rejects missing browser/private storage settings. Recovery mode rejects workers.

`GET http://127.0.0.1:3011/ready` returns 200 when ready and 503 otherwise. The
port is loopback-only; keep it private. Change
`WORKER_HEALTH_PORT` for multiple local worker processes. Startup waits are
bounded. SIGTERM stops intake and drains active jobs; allow at least 75 seconds
in the runtime. The internal shutdown deadline is 60 seconds.

## Operations

Start and supervise the worker independently using its own environment settings.
`DATABASE_URL` and `REDIS_URL` must point to the same services as the API.
Install a compatible Chromium browser with its OS/font dependencies and keep the
browser sandbox enabled. Run as a non-root user on Linux and verify rendering on
the intended host. The worker does not install a browser, migrate the database
or create backups; migrations use the API's explicit command.

Queue IDs and prefix `bull` are preserved: no Redis clearing or data reset is
needed. Stop the old worker before starting the new one. Stable recurring IDs
prevent duplicate schedules, now registered only by workers. Each replica has
up to four pooled DB connections and one active job per supported queue. Start
with one worker and measure before increasing replicas.

Manually check worker readiness and request a PDF through the API on staging.
Confirm the job completes with a private download and that failed jobs remain
visible in logs. Monitoring and alert delivery need separate configuration. See
[manual release checks](../../docs/23-release-checklist.md).

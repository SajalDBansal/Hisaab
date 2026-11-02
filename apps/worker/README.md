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
| `src/health.ts`         | Loopback readiness; consumers, Redis PING and database probe          |
| `src/healthcheck.ts`    | Readiness client with a bounded timeout                               |
| `src/backup/` | Whole-database capture, private R2 publication, ownership/status and host-only operator commands |

Shared queue payloads, database tables, PDF storage and accounting readers live
in `@repo/backend`. The worker never imports `apps/api/src`.

## Commands

Copy `apps/worker/.env.example` to `apps/worker/.env` and fill the same
DB, Redis and private storage settings used by the API. Start development
PostgreSQL/Redis with `docker compose -f deployment/compose.dev.yml up -d --wait`
from the repository root. Configure
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
`WORKER_HEALTH_PORT` for multiple local worker processes. Startup and readiness
probe PostgreSQL and Redis concurrently. PostgreSQL uses a separate,
single-connection pool with one-second connection/query deadlines. Redis uses a
dedicated PING connection with one-second command/socket deadlines, no offline
queue and `maxRetriesPerRequest: 1`. Failed probe connections are discarded so
readiness can recover when either service resumes. Connection error logs identify
the dependency without including its error details. Probe limits do not apply to
business queries or BullMQ connections.

SIGTERM closes both probe connections, stops intake and drains active jobs. Allow
at least 75 seconds in the runtime; the internal shutdown deadline is 60 seconds.

## Operations

Start and supervise the worker independently using its own environment settings.
`DATABASE_URL` and `REDIS_URL` must point to the same services as the API.
Install a compatible Chromium browser with its OS/font dependencies and keep the
browser sandbox enabled. Run as a non-root user on Linux and verify rendering on
the intended host. The worker does not install a browser, migrate the database
at startup; migrations use the API's explicit command. The built image includes
PostgreSQL 17 clients for opt-in whole-database backups. Backup credentials belong
to a separate private bucket and publication defaults to disabled. Read
[guide 30](../../docs/30-postgres-r2-backup-and-ec2-migration.md) before enrollment,
enabling the 02:00 India schedule, or transferring writer ownership after a restore.

Queue IDs and prefix `bull` are preserved: no Redis clearing or data reset is
needed. Stop the old worker before starting the new one. Stable recurring IDs
prevent duplicate schedules, now registered only by workers. Each replica has
up to four pooled job DB connections plus one readiness connection, and one
active job per supported queue. Enabled backups use one additional dedicated
PostgreSQL connection to hold their session lock and exported snapshot. Start with one worker and measure before
increasing replicas.

Manually check worker readiness and request a PDF through the API on staging.
Confirm the job completes with a private download and that failed jobs remain
visible in logs. Monitoring and alert delivery need separate configuration. See
[manual release checks](../../docs/23-release-checklist.md).

### Readiness verification — 26 October 2026

Focused checks exercised the shared PostgreSQL/Redis clients and worker HTTP
health server against local protocol stubs. Each dependency passed 120 concurrent
stalled requests across four rounds, followed by recovery after every round.
PostgreSQL retained at most one readiness connection, with no leftover clients or
waiters; startup connection/query deadlines and idle-disconnect recovery passed.
Redis retained at most two connections (one job client and one probe), with no
queued commands after recovery. Its probe reported 503 while the stalled job
connection still reported `ready`, and disconnecting the probe left that job
connection usable. Separate 1.6-second database and Redis job commands completed,
confirming the probe deadlines do not affect business work.

Worker typecheck, lint and build passed. Final Linux-image checks also paused
disposable PostgreSQL and Redis separately: API and worker returned bounded 503
responses twice for each outage, API liveness stayed 200, and readiness recovered
after each dependency resumed. Actual PDF, reminder-preparation and cleanup jobs
passed with the sandboxed browser. Temporary harnesses are not part of the
application. See the [readiness audit](../../docs/27-private-readiness-audit.md)
for integrated evidence and the remaining EC2/provider/device checks.

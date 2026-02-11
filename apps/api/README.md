# Hisaab API

Fastify HTTP application for authentication, firm permissions, accounting writes,
reports, documents and sync. Background consumers now live in
[`apps/worker`](../worker/README.md). This application only submits jobs.

## Local Setup

From the repository root, install Node from `.nvmrc` and Bun 1.4.0, run
`bun install --frozen-lockfile`, and provision separate development PostgreSQL
and Redis services. Copy `apps/api/.env.example` to an ignored `apps/api/.env`,
set `DATABASE_URL` and `REDIS_URL`, and review the remaining values.

```sh
bun run --cwd apps/api db:migrate
bun run --cwd apps/api dev
# Another terminal for background work:
bun run --cwd apps/worker dev
```

Use the API port configured in `.env` (default 3000). `/health` is liveness;
`/ready` checks dependencies. Readiness does not certify worker, email or R2
functionality. API documentation is at `/docs` when enabled by the app's policy.

## Commands

| Command from repository root         | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `bun run --cwd apps/api build`       | Compile `dist/server.js`, `dist/migrate.js` and shared chunks |
| `bun run --cwd apps/api start`       | Start the built API                                           |
| `bun run --cwd apps/api typecheck`   | Check API source and imported shared types                    |
| `bun run --cwd apps/api lint`        | Check API source conventions                                  |
| `bun run --cwd apps/api db:generate` | Generate reviewable SQL after shared schema changes           |
| `bun run --cwd apps/api db:migrate`  | Explicitly migrate the configured database                    |

Do not use `drizzle-kit push` in production. Migrations stay in `src/db/migrations`; schema
source is `packages/backend/src/db/schema`. The extraction does not change tables.

## Manual Build and Start

Use the app's environment settings for the target database. Before an upgrade,
verify a database backup and pause API/worker writes, then apply reviewed
migrations explicitly. From the repository root:

```sh
bun run --cwd apps/api db:migrate
bun run --cwd apps/api build
bun run --cwd apps/api start
```

Migrations are not an API startup side effect. Start the worker separately;
hosting, process supervision, HTTPS and backups require manual setup. See
[manual release checks](../../docs/23-release-checklist.md).

## Configuration

- `DATABASE_URL`, `REDIS_URL`: same services as the worker.
- `BETTER_AUTH_SECRET`: strong stable session secret; never commit it.
- `BETTER_AUTH_URL`: exact API HTTPS origin in production.
- `TRUSTED_ORIGINS`: exact signed-in app origin and `hisaab://`; no wildcard.
- `TRUSTED_PROXY_CIDRS`: only the actual reverse proxy addresses.
- `RESEND_API_KEY`, `EMAIL_FROM`: verified production sender. Development can log codes.
- `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`:
  private documents bucket, never the public APK release bucket. S3 is also supported.
- `SENTRY_*`: optional error reporting and release attribution.

For phone development use `HOST=0.0.0.0`, a reachable LAN API URL in native
configuration, the matching trusted Expo web origin, and a narrowly scoped local
firewall rule. Never use development HTTP URLs in production builds.

## Layout

```text
src/server.ts          HTTP startup and graceful shutdown, job producer only
src/app.ts             Fastify application composition
src/config/env.ts      API environment validation
src/auth/              Sessions, verification and device transfer
src/plugins/           Errors, security, tenant context, limits and job producer
src/modules/           HTTP routes and API-specific services
src/db/migrations/     Explicit, reviewed SQL migration history
packages/backend/     Shared DB schema, repositories, queues and print services
apps/worker/           Actual queue consumers and browser rendering
```

Firm routes require authentication and firm context. Creates use idempotency keys;
edits use versions/`If-Match`. Do not bypass these contracts when adding routes.
See [system architecture](../../docs/02-system-architecture.md),
[background jobs](../../docs/21-background-jobs.md).

# Hisaab

Hisaab is a firm-based accounting and business-management application for sales,
purchases, stock lots, receipts, payments, journals, business associates and
financial reports. GST, non-GST and combined books share the same accounting
engine. It is an accounting tool, not an automated tax-filing service.

## Applications

| Location                                           | Responsibility                                                |
| -------------------------------------------------- | ------------------------------------------------------------- |
| [apps/native](apps/native/README.md)               | Expo Android/iOS app and signed-in web application            |
| [apps/web](apps/web/README.md)                     | Public Next.js product, help and download website             |
| [apps/api](apps/api/README.md)                     | Fastify HTTP API, authentication, authorization and mutations |
| [apps/worker](apps/worker/README.md)               | Independent BullMQ consumer, PDF rendering and scheduled jobs |
| [packages/backend](packages/backend/README.md)     | Shared server schema, repositories, queues and services       |
| [packages/core](packages/core/README.md)           | Shared accounting calculations and business rules             |
| [packages/contracts](packages/contracts/README.md) | Validated request/response and export contracts               |

## Start Locally

Install Node 24 (see `.nvmrc`) and Bun 1.4.0, and provide development PostgreSQL
and Redis services. Run commands from this folder.

```sh
bun install --frozen-lockfile
```

Use each app's `.env.example` to configure ignored `.env` files for API/worker
and `.env.local` files for native/web. Preserve existing env files. API and worker
must share PostgreSQL, Redis and the private document bucket. PDF jobs also need
a local Chromium/Edge executable configured in the worker; see its README.

```sh
bun run --cwd apps/api db:migrate
bun run --cwd apps/api dev
# Separate terminal:
bun run --cwd apps/worker dev
# Separate terminal:
bun run --cwd apps/native start
# Optional public website, another terminal:
bun run --cwd apps/web dev
```

For a physical phone, use the computer's reachable LAN API address in native
configuration, allow that API port through the local firewall and keep both on
the same network. `localhost` on a phone points to the phone. See app READMEs
for port, authentication, offline and browser-specific setup.

## Manual Builds

```sh
bun run build
# Signed-in browser app, exported separately:
bun run --cwd apps/native export:web
```

The workspace build compiles the API, worker and public website. The native
README covers manual Expo builds. Hosting, publication and full backups are
manual responsibilities; this repository supplies no deployment automation.

New browser builds need network access to open or reload. Cached books and queued
writes remain available within an already loaded app; native offline behavior
remains available subject to its access and storage limits.

## Guides

Start with the [documentation index](docs/README.md). Guides are numbered in reading
order: product and architecture, daily bookkeeping, storage and recovery, then
runtime and release checks. App READMEs remain the source for local run commands.

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

Install Node 24 (see `.nvmrc`), Bun 1.4.0 and Docker. Run commands from this folder.
On Windows, enable long paths first (`LongPathsEnabled=1` under
`HKLMSYSTEMCurrentControlSetControlFileSystem`, admin PowerShell); otherwise
`bun install` silently skips deep React Native and Expo files.
Development Compose starts only PostgreSQL and Redis; the apps run on your computer.

```sh
docker compose -f deployment/compose.dev.yml up -d --wait
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
README covers manual Expo builds. Four Dockerfiles, Compose and a GitHub Actions
workflow package the services for EC2. Provider setup, production credentials,
Android publication and independent backups remain operator responsibilities.

The [deployment folder](deployment/README.md) contains the Dockerfiles and three
Compose files: development dependencies, local app containers and production.
It includes env templates and exact commands for each mode.
Production runs PostgreSQL and Redis beside the apps on EC2, with private
networking and persistent volumes. Follow guide 26 for credentials, backups and
first startup; the development database credentials are not for deployment.

New browser builds need network access to open or reload. Cached books and queued
writes remain available within an already loaded app; native offline behavior
remains available subject to its access and storage limits.

## Guides

Start remaining implementation with the [current system audit](docs/29-system-audit-and-work-plan.md)
and [daily PostgreSQL backup / EC2 migration plan](docs/30-postgres-r2-backup-and-ec2-migration.md).
Track fixes and acceptance in [implementation and verification](docs/31-implementation-and-verification.md).
Automatic backups require a separate private bucket, host enrollment and explicit
enablement; they remain disabled until the owner completes that setup and verification.

Start with the [documentation index](docs/README.md). Guides are numbered in reading
order: product and architecture, daily bookkeeping, storage and recovery, then
runtime and release checks. App READMEs remain the source for local run commands.

To finish and deploy this project, read the [phased completion plan](docs/24-completion-plan.md),
[Docker/CI/CD guide](docs/25-docker-and-cicd.md) and
[EC2/Expo walkthrough](docs/26-ec2-and-expo-deployment.md). The
[readiness audit](docs/27-private-readiness-audit.md) records completed local
checks and remaining deployment/device acceptance. Normal registration supports
multiple accounts and firms; there is no installation-wide owner email allowlist.

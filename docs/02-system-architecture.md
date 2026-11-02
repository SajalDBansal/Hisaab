# 02. System Architecture

[Documentation index](README.md)

## Process Boundaries

```text
Public product website (Next.js) ------> Public R2 APK release bucket
              |
              +----> Signed-in Expo web / Android / iOS
                                  |
                             HTTPS API
                        authentication + roles
                         /                 \
               PostgreSQL container  Redis queue container
                                           |
                                  Independent worker
                                  /               \
                              PostgreSQL     Private R2 documents/PDFs
```

`apps/api` owns HTTP validation, identity, tenant authorization, transactional
mutations and job submission. `apps/worker` owns background execution. They share
`packages/backend` for schema/repositories/queue contracts, and `packages/core`
for financial rules. Neither production app imports the other's source code.

PostgreSQL is authoritative. Redis provides rate limits and job coordination,
not the only copy of financial books. Queue durability requires AOF and
`noeviction`. R2 stores files, not executable application servers.

## Running the Applications

API, worker, public website and signed-in browser export remain separate
applications. Use their READMEs for local commands and manual builds. API and
worker share `DATABASE_URL`, `REDIS_URL` and private document storage, with
separate app environment files. Development Compose supplies only PostgreSQL and
Redis; apps run on the host. The [deployment folder](../deployment/README.md) also
provides local app containers and a production setup with PostgreSQL and Redis
on the same EC2 host. Only API/worker join the internal database network.
Production Compose supplies their database URLs from passwords in its private
`.env`; data stays in persistent volumes and requires backups outside the host.

Schema migrations remain in `apps/api/src/db/migrations` and run explicitly with
`bun run --cwd apps/api db:migrate`. Neither application startup nor worker startup
migrates the database. The production Compose file supervises containers behind
Caddy HTTPS. The GitHub workflow builds images and can deploy after the operator
configures services, secrets and SSH access; see [guide 25](25-docker-and-cicd.md).

New signed-in browser builds require network access to open or reload. Existing
encrypted books and queued writes can be used within an already loaded app.
Native offline storage and access rules remain in place. See
[offline books](17-offline-books.md) and [manual release checks](23-release-checklist.md).

## Work Ownership

| Work                                                       | Owner                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Login, permissions, bill posting, stock/journal validation | API + shared accounting engine                        |
| Authentication emails                                      | API email adapter; not a durable BullMQ email queue   |
| Attachment validation/compression and thumbnails           | API upload-confirmation service                       |
| Reports and report exports                                 | API request path using shared calculations            |
| Invoice PDF rendering                                      | Worker with sandboxed Chromium                        |
| Scheduled reminder preparation and cleanup                 | Worker                                                |
| Financial JSON export and new-firm restore                 | Owner-authorized API and app workflow                 |
| Full backups, offsite copies, restore and storage review   | Owner-arranged manual procedures                      |
| APK build/signing/publication                              | Manual Expo builds and separately managed publication |

The extraction does not invent implementations for unsupported `messages`,
`reports` or `backup` queues. Moving attachment processing or email delivery to
durable queues separately requires persisted pending/failed states and idempotent
completion, not just a moved function.

## Reliability And Security

- API enqueue connections fail promptly during Redis outages; worker connections
  keep reconnecting. Consumers drain on SIGTERM with a shutdown deadline.
- API permissions are checked before PDF jobs are created. Jobs reload
  firm-scoped data and store content-addressed artifacts. Authorized HTTP reads
  issue fresh download URLs; Redis never stores them as permanent results.
- Shared invoice printing reads a repeatable-read snapshot, preventing mixed
  committed versions while generating a document.
- Stable scheduler IDs and queue prefix are preserved; only workers register
  schedules. Financial write locks and idempotency rules remain unchanged.
- Public APK releases must never share a public bucket with customer documents,
  private PDFs or encrypted operational backups.
- Availability, monitoring and recovery depend on the hosting setup. Independent
  API and worker processes allow separate supervision and scaling; the repository
  supplies no configured hosting or automatic failover.

See [BullMQ connections](https://docs.bullmq.io/guide/connections) and
[graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown).
Recovery remains an owner responsibility; see
[manual recovery responsibilities](20-manual-recovery.md).

# Shared Backend Library

Server-only code used by the API and independent worker. This package is not a
server, reads no env files on import, and starts no listeners, queues or workers.
Runtime owners supply validated configuration.

- `db/client.ts`: PostgreSQL pool factory and shared Drizzle types.
- `db/schema`: the one canonical schema used by both processes.
- `jobs/queues.ts`: queue contracts, producers, deduplication and retry rules.
- `jobs/schedule.ts`: recurring schedule registration called by worker startup.
- `modules`: shared accounting readers/persistence and PDF artifact services.
- `lib`: shared errors, Redis factories, observability and storage contracts.

The existing service/repository folder layout is retained to keep the extraction
mechanical. Some readers and transactional helpers are coupled by the existing
voucher hydration model; they remain shared, not copied into worker code.
Pure financial calculations still belong in `@repo/core`.

Import the module needed, such as `@repo/backend/db/client`. Both applications
bundle this package's TypeScript with tsup. Do not import it from Expo or the
public website: it has privileged server dependencies. Do not import application
entrypoints into this library.

SQL migrations remain owned by `apps/api/src/db/migrations` and its explicit
migration command. Moving schema source creates no migration and changes no
database tables. Review generated SQL before committing it.

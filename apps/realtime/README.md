# Hisaab Realtime

The live-update service. It is a standalone application, separate from `apps/api`,
and it is stateless. It holds open WebSocket connections and tells each one when
its firm's books change. It never sends book data and never accepts writes. The
design is in [doc 33 §3](../../docs/33-offline-rbac-realtime.md).

## Layout

| File                | Purpose                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| `src/server.ts`     | Validate settings, start HTTP (`/health`, `/ready`) and the socket, drain on shutdown |
| `src/hub.ts`        | Passes, access checks, presence, fan-out, heartbeats and limits           |
| `src/bus.ts`        | One PostgreSQL `LISTEN hisaab_live` connection, reconnecting with back-off |
| `src/config/env.ts` | Only the settings this service needs                                      |

## Run locally

```bash
# Same LIVE_TICKET_SECRET as the API; the API also needs LIVE_PUBLIC_URL=ws://localhost:3020/live
DATABASE_URL=postgres://hisaab:hisaab@localhost:55432/hisaab \
LIVE_TICKET_SECRET=local-only-live-secret-make-it-32-chars-long \
bun run dev:realtime
```

## Tests

```bash
cd apps/realtime
LIVE_TEST_DATABASE_URL=postgres://…/hardening_data LIVE_TEST_REDIS_URL=redis://127.0.0.1:16379/0 bun test
```

The database must be a migrated, disposable `hardening_*` database on localhost.
Without the two variables, only the pass tests run.

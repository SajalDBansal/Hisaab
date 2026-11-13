# 33. Offline Viewing, Access Control and Real-Time Design

[Documentation index](README.md) | [Offline books](17-offline-books.md) | [Work plan](32-production-polish-audit-and-work-plan.md)

**Written 2 November 2026.** Parts 1 and 2 describe the implemented system on
branch `phase4/offline-read-only`. Part 3 is the design for the planned
WebSocket layer; nothing in it is built yet.

## 1. Offline Viewing

### Decision

Offline is **view-only**. Entries are created and changed only online, where the
server's posting rules (numbering, stock lots, credit, period locks, roles) apply
at once. No local writes means nothing to merge, so the offline sync problem does
not exist. Accounting data can't be merged safely after the fact: two devices can't
both issue the next invoice number or sell the last units.

### Flow

| Step | What happens |
| --- | --- |
| Download | Lists first (parties, items, vouchers, orders, settings) in one batch, then every detail, report, GST and settings read in batches of up to 200 via `POST /v1/reads/batch`. Reads the role may not see are skipped. |
| Server side of a batch | Each path runs through its own route in-process with the caller's identity, so permissions, validation and the response are identical to a single request. The firm's books are loaded once per batch (`withSharedReportBooks`). The batch counts once against the 300/min limit, and file-rendering paths are refused. |
| Cache | Answers are stored under their exact path, encrypted (AES-GCM; key in SecureStore on phones, a non-extractable Web Crypto key in the browser), scoped to user, firm and role, and written once per download. Paths come from `OFFLINE_READABLE_PATH`, shared by the phone and the batch endpoint. |
| Reading offline | A request that can't reach the server returns the cached answer for that exact path. A missing answer shows **You're offline**, never made-up figures. Access needs a membership checked online within 24 hours. |
| Saving offline | Refused before anything is stored: *"You need to be online to create or update an entry."* The form keeps its values. |
| Saving online | Sent at once under a retry key. If the reply is lost, the entry is kept and the server is asked for its original answer when online. Background sync never posts; the user re-saves or uses **Check and save now**, both under the same key. |
| Freshness | Normal online screens refresh their cached answers as they are used. A new download replaces the rest. |

**Measured** (browser, fixture firm): the download takes about 3 s and 5 requests
(3 batches plus 2 access checks). 68 of 71 screens show their data offline; documents,
account sessions and backup state that they need a connection. Online, all 142
screen checks pass. Earlier, a download was one request per record (2,000+ for a
modest firm) and failed at the rate limit.

### Later: a local database (optional)

With view-only offline, a local SQLite copy would mainly add arbitrary offline
filters and date ranges. Do it only by moving each read route's pure logic into
shared functions that both the server and the phone run on the same book data, so
results match by construction. Update the copy from `GET /v1/sync/changes`, which
is already role-filtered. Until then, exact-path caching is simpler and always
matches the server.

## 2. Role-Based Access Control

### Model (`packages/core/src/permissions.ts`)

| Permission | Owner | Accountant | Sales staff | Viewer |
| --- | :-: | :-: | :-: | :-: |
| sales (sales, receipts, customers) | ✓ | ✓ | ✓ | |
| purchase (purchases, payments, suppliers) | ✓ | ✓ | | |
| payments (cash and bank) | ✓ | ✓ | | |
| accounts (journals, final accounts) | ✓ | ✓ | | |
| gst | ✓ | ✓ | | |
| reports (read all books) | ✓ | ✓ | | ✓ |
| settings | ✓ | ✓ | | |
| team | ✓ | | | |

Reading follows from this (`apps/api/src/lib/read-permissions.ts`): `reports` reads
all books, while sales staff read only sales-side vouchers and customers. Cash and
bank balances are zeroed for roles without `reports`. Commission and associate
fields are removed by role from every response (`associatePayloadForRead`).

### Where it is enforced

1. **Every firm route** uses `app.inFirm(permission)`: session check, firm
   membership (the same reply for "no such firm" and "not your firm"), and then the
   permission.
2. **Every write re-checks inside its transaction.** Under the firm lock the
   membership is reread, and a changed role is refused (`ROLE_CHANGED`). Rights are
   checked per voucher type (`requireRight`). Supplier writes need `purchase` on
   every path (A01).
3. **Durable retries** must match the original role and still hold the permission.
4. **The sync feed and the batch endpoint** apply the same read rules. A batch
   cannot widen access, because each path runs its own route.
5. **The phone** hides what a role can't do, but the server never relies on that.
   The offline cache is scoped to user, firm and role; a role change or access
   loss clears it.
6. **Owner protection:** the owner can't be changed or removed.

### Is it working?

Evidence: system acceptance checks owner, accountant, sales, viewer and an
outsider at the same time, plus firm isolation (14/14 pass). The A01 test covers
supplier writes over direct HTTP, operations and sync. The batch test checks that
another account gets 403.

Findings and what was decided:

| # | Finding | Outcome |
| --- | --- | --- |
| R1 | `GET /v1/items` and `/v1/items/stock-lots` were open to any member and included **purchase price, opening cost and lot cost**, so sales staff saw buying costs (the sale form's lot picker showed "Cost ₹…"). | **Done (12 Nov 2026).** Roles without `purchase` or `reports` (sales) get every cost blanked by `costPayloadForRead`. It runs on every firm reply, inside batched reads and on the offline copy. Sales staff can't set a purchase price, opening stock or opening lots, and their item edits keep the stored cost. The app hides stock value, lot costs and cost fields for them. Sales still save their real FIFO cost. Tests: `packages/core/tests/cost-visibility.test.ts`, `apps/api/tests/cost-visibility.test.ts`. |
| R2 | There was no ownership transfer, because the owner couldn't be changed. | **Done (12 Nov 2026).** `POST /v1/firms/current/transfer-ownership` takes `{ memberId, previousOwnerRole, confirmName }`. It runs in one transaction under the firm's write lock, so the firm always has exactly one owner. The owner chooses their own new role and types the firm name to confirm. The change is written to the firm's control history. In the app: Team → member → **Make owner**. Test: `apps/api/tests/ownership-transfer.test.ts`. |
| R3 | Offline access lasts up to 24 hours after the last online check, so a revocation isn't seen while a device stays offline (documented). | Keep the limit. Live updates (section 3) close the window for devices that are online. |

## 3. Live Updates (WebSocket). **Built 12 Nov 2026**

### What it does

1. **Screens update by themselves.** When anyone saves, every open screen of that
   firm refetches within about a quarter of a second, on every device. In the
   end-to-end check, sales staff added a customer and the owner's open Parties
   screen showed it 226–261 ms later, without a reload.
2. **The owner sees who is online.** The Team screen shows "Online on Chrome on
   Windows" (or the phone's name), or "Active 5 min ago" for people who aren't.
3. **Access changes act at once.** A role change, removal or ownership hand-over
   closes that person's connection. Their app reloads the firm list and
   reconnects with the new role. Logging out, or a device takeover, closes that
   session's connection.

It never carries book data and never saves anything. Every message only says
"something changed", and the app refetches through the normal REST routes. Role
checks, cost hiding and the offline copy therefore all stay in one place.

### Two services, both stateless

```text
 app / browser ──REST──► API (apps/api) ──commit──► PostgreSQL ──NOTIFY hisaab_live──┐
       │                    │  POST /v1/live/ticket                                  │
       │                    └─ signs a one-time pass (HMAC, 60 s)                    ▼
       └──── wss://api…/live ──► Caddy ──► realtime (apps/realtime) ◄─ LISTEN ───────┘
                                              │
                                              └─ Redis: who is online, used passes
```

| Concern | How |
| --- | --- |
| Separate services | `apps/realtime` has its own process, image (`hisaab-realtime`) and Compose service. It shares only PostgreSQL, Redis and `packages/backend/src/lib/live*.ts` with the API. It holds no session, email or storage secrets. |
| Stateless | Neither service keeps anything another instance needs. Events arrive through PostgreSQL `LISTEN/NOTIFY`, so every realtime instance hears every event. Who is online is stored in Redis entries that expire after 75 s unless a heartbeat refreshes them. Used passes are kept in Redis too, and access is checked against the database. A realtime instance holds only its open sockets. On restart it closes them with code 1012 and clients reconnect to any instance. To scale, add replicas. |
| Change notices | After every successful firm write, the API bumps the firm's data version (the ETag key). It now also sends `pg_notify('hisaab_live', {t:"changed", f, v})`. POSTs that only read are marked `readOnly` and send nothing: batched reads, report export, document search and the pass itself. Before this change they bumped the version too, which needlessly invalidated everyone's cached reads. |
| Access notices | Migration `0030_live_notices` adds database triggers. Inserting, deleting or changing the role of a `member` row sends a notice, and so does deleting a `session` row. Because the trigger fires inside the database, every code path is covered, including Better Auth's own logout and device takeover. PostgreSQL delivers NOTIFY only on commit, so rolled-back work never announces itself. |
| Authentication | 1. The app asks the API for a pass (`POST /v1/live/ticket`, any member). The pass names the user, the session and the open firm. It lasts 60 s and works once.<br>2. The app opens the socket and sends `{type:"hello", ticket, platform, device}` within 5 s.<br>3. The realtime service checks the signature and marks the pass used in Redis. It then checks in the database that the session is live and the person is still a member.<br>4. It replies `ready` with the firm's current version.<br>Web pages must come from `TRUSTED_ORIGINS`; apps send no Origin. |
| Fan-out | `changed` and `presence` notices are merged per firm for 50 ms. and `presence` goes only to roles that manage the team. `access` goes to every socket of that person; their socket in that firm is rechecked and closed with 4403 if the role changed. `session` closes that session's sockets with 4401. Every socket is also rechecked every 5 minutes. |
| Gaps | The app remembers the last version and refetches on any `ready` that carries a different one. A missed notice therefore can't leave a screen stale. If the realtime service loses its LISTEN connection, it sends `resync` to everyone after reconnecting. |
| Presence | `GET /v1/firms/current/presence` (team permission) combines the members, their sessions' `last_active_at` and the Redis entries. It refetches on each `presence` notice, and every 60 s as a fallback. |
| Limits | 16 KB messages. Only one client message is accepted: the hello. Each person may have 5 connections across all instances (counted in Redis, close code 4429). The server sends a ping and an app-level `beat` every 25 s and drops a socket that misses a pong. The app treats 2.5 beats of silence as a lost connection. |
| App | `useLiveUpdates` in the DataProvider keeps one connection per signed-in firm. It reconnects with back-off and jitter: 1 s up to 60 s, or 1–5 s after a server restart. It disconnects in the background and reconnects when the app returns or the browser comes back online. Notices are debounced 100 ms before refetching, and ETags keep unchanged reads cheap. |
| Without it | If `LIVE_TICKET_SECRET` and `LIVE_PUBLIC_URL` are not set in the API, the pass route answers `{enabled:false}` and the app checks again in 10 minutes. Everything else works as before. |

### Files

- Shared:
  - `packages/contracts/src/live.ts`: messages, close codes and presence.
  - `packages/backend/src/lib/live.ts`: events and passes.
  - `packages/backend/src/lib/live-presence.ts`: presence in Redis.
- API: `apps/api/src/modules/live/live.routes.ts`, `apps/api/src/plugins/cache.ts`
  and migration `0030_live_notices.sql`.
- Realtime: `apps/realtime/src/{server,hub,bus}.ts` and `config/env.ts`.
- App: `apps/native/src/data/liveConnection.ts` and `useLiveUpdates.ts`. The
  Team screen shows presence.
- Deployment:
  - `deployment/Dockerfile.realtime` and `realtime.env.example`.
  - The `realtime` service in both Compose files and `/live` in the Caddyfile.
  - The publish matrix and the deploy script (guide 26).

### Tests

- `apps/realtime/tests/live.test.ts` runs against PostgreSQL and Redis. It covers:
  - bad, reused and foreign passes, and connections from other sites;
  - commit-only delivery, firm isolation and merging of quick notices;
  - presence notices reaching owners only;
  - role change, removal and logout closing the right socket;
  - the per-person limit and the hand-back on restart.
- `apps/api/tests/live.test.ts` covers the pass contents, no notices for reads or
  batched reads, one notice per committed write, the role-change trigger and
  owner-only presence.
- `apps/native/checks/live-connection.test.js` covers the hello, passing notices
  on, access changes, retries, the disabled state and stop.
- End to end, with the two services as separate processes and two browsers:
  9/9 checks.

### Before production

Generate one random value and set it as `LIVE_TICKET_SECRET` in both `api.env`
and the new `realtime.env`. Also set
`LIVE_PUBLIC_URL=wss://api.hisaab.sajaldbansal.com/live` in `api.env` (guide 26).
The deploy script now requires `realtime.env`.

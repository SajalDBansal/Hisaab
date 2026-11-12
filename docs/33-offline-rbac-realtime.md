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
| R3 | Offline access lasts up to 24 hours after the last online check, so a revocation isn't seen while a device stays offline (documented). | Keep the limit; the WebSocket layer below closes the window for online devices. |

## 3. WebSocket Layer (design)

### Goals

1. Owners see who is online, on which device, and when each person was last active.
2. Every open screen updates when data changes, consistently and without
   reloading.

### Design

| Concern | Design |
| --- | --- |
| Transport | `@fastify/websocket` on the existing API process at `wss://api…/v1/live`. Caddy proxies WebSockets as is. |
| Authentication | The upgrade request carries the same session cookie (browsers send it; React Native passes it in the WebSocket `headers` option). Check it with Better Auth, check `Origin` against `TRUSTED_ORIGINS`, and close with 4401 if invalid. |
| Firm scope | The client sends `{type:"subscribe", firmId}`. The server checks membership and role exactly like `inFirm`, and rechecks on every membership change and every 5 minutes. |
| Change source | A trigger on the existing per-firm `change_log` (already serialized per firm and written in the same transaction as each change) calls `pg_notify('hisaab_changes', {firm, seq, entity, id})`. PostgreSQL delivers notifications **only on commit**, so rolled-back work never announces itself. One dedicated LISTEN connection per API process fans out to that firm's sockets. If several API processes are ever run, each one LISTENs. |
| Message content | **Invalidations, not data**: `{type:"changed", seq, entities:[{entity:"voucher", id}]}`. The client invalidates the matching React Query keys and refetches through the normal REST routes, so role filtering, redaction and offline caching stay in one place. |
| Gaps | The client tracks the last `seq`. On reconnect it sends `{type:"resume", since}`; the server replays from `change_log` or replies `resync`, and the client then invalidates all book queries. No missed update can leave a screen stale. |
| Presence | An in-memory map of firm → user → connections (platform, device, connected at, last seen), broadcast only to members with `team` (owners). Heartbeats every 25 s; a socket missing two is dropped. Last activity is also written to `session.lastActiveAt`, as today. |
| Sessions | When a login takes over a device's slot, or the user logs out or loses access, the server closes that user's sockets with a reason (4403 or 4409). That also ends the offline grace window for online devices (R3). |
| Limits | At most 5 sockets per user and 64 KB per message. Client messages are validated with zod, a socket flooding messages is rate-limited, and connections back off with jitter (1 s up to 60 s). |
| Offline | When the socket connects, the app runs the retained-entry check. Incoming change events refetch only the affected paths, which also refreshes the offline cache incrementally between full downloads. |
| What it never does | Carry writes (REST stays the only write path), send financial records to roles that can't read them, or act as the source of truth. A missed message is repaired by `resume` or `resync`. |

### Build order

1. Add the `change_log` NOTIFY trigger in a migration, plus the LISTEN fan-out with tests (commit-only delivery, firm isolation).
2. Add the `/v1/live` socket: authentication, subscribe, resume/resync, heartbeats, limits.
3. Client hook: connect when online, invalidate queries on `changed`, back off on reconnect.
4. Presence for owners (team screen: online now, device, last seen).
5. Close sockets on logout, takeover and membership change; update the offline grant.

Acceptance: two browsers on one firm show a new sale on the other screen within
1 s. A rolled-back write sends nothing. Another firm's sockets get nothing. Sales
staff never receive supplier invalidations they can't read. A dropped connection
catches up through `resume`.

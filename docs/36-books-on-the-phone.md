# 36. Books on the Phone (Local Replica)

Built 13 Nov 2026. The firm's books are always on the device, kept in step with
the server, and readable offline without pressing "Download books".

## Rules

1. **The server is the only place entries are saved.** A save goes to the
   server. The phone's copy changes only from what the server committed, so the
   two cannot disagree. Writing to both places independently would let them
   drift whenever one write failed; that is why the phone never writes its own
   copy.
2. **Offline is view-only.** Every save is refused with "You're offline. You
   need to be online to create or update an entry." The form is kept.
3. **Who gets a copy.** Owner, accountant and viewer get the full copy, because
   their roles read the whole books. Sales staff may not see purchases or costs,
   so they keep the screen-by-screen offline download from doc 17.

## Flow

| When | What happens |
| --- | --- |
| First sign-in on a phone | "Downloading your firm's books… N%". It reads `replica/head` (the change cursor) and every party, item and voucher in pages of 500, then any changes made meanwhile. For 2,400 entries this took about 2 s (10 requests). |
| Every sync | It asks `replica/changes?since=<cursor>` for the records changed since then, and writes them and the new cursor in one SQLite transaction. |
| Sync triggers | A live "changed" notice (about 0.3 s after any save), opening the app, returning to it, and every 60 s. |
| Checking | After the first download and every 20th sync, a checksum of every row is compared with the server's. A mismatch downloads the books again. |
| Offline | The first failed request (or the browser's offline event) switches screens to the phone's books. They are computed by the same `@repo/core` functions the server uses, so the numbers match. |
| Back online | The next answer (a probe every 5 s) switches back. A sync brings in whatever was saved meanwhile. |
| Sign-out, or a server restore | The copy is wiped. |

## Consistency

- **Commit-ordered changes.** Every save writes a `change_log` row (database
  triggers on parties, items, ledgers and vouchers), numbered in commit order
  under the firm lock. Every voucher change goes through one persist path that
  bumps the voucher row, so changes to lines, charges, allocations and postings
  are logged too.
- **One snapshot per answer.** Each replica route reads in one repeatable-read
  transaction, so the cursor and the rows it reports come from the same moment.
  The first download then fetches changes since the head cursor, so rows saved
  while the pages were read are not missed.
- **Atomic writes.** On the phone, rows and the cursor are saved in one
  transaction; a failed write leaves both as they were (tested).
- **Exact shape.** Rows are the server's own book shape, built by the same
  mapping as the server's reports (`loadBookPart`). The test compares the phone
  and the server row by row after downloads, sales, receipts, edits, removals
  and cancellations.
- **What the copy leaves out.** The bills' print copies are left out; only
  printing and editing use them, and both need a connection.

## Storage

- **Phones:** SQLite (`expo-sqlite`), encrypted with SQLCipher. The 256-bit key
  is kept in the secure keystore and never leaves the device. The table is
  `replica_rows(owner, kind, id, json)` plus `replica_meta`, with
  `owner = user:firm`. There is no size cap like the old 25 MB blob, and a sync
  writes only the rows that changed.
- **Web:** the same engine on the encrypted IndexedDB store, one record per firm
  and table.

## Code

| Piece | Where |
| --- | --- |
| Sync engine, checksum, assembling the books | `packages/core/src/replica.ts` |
| Routes `GET /v1/replica/head`, `/rows`, `/changes` (reports permission) | `apps/api/src/modules/replica/replica.routes.ts` |
| Partial book loader | `loadBookPart` in `packages/backend/src/modules/reports/books.ts` |
| SQLite store / web store | `apps/native/src/replica/sqlStore.ts`, `replicaStore.ts`, `replicaStore.web.ts` |
| Offline services (core services on the phone's books, writes refused) | `apps/native/src/replica/localServices.ts` |
| Lifecycle, switching and banners | `useReplica.ts`, `DataProvider.tsx`, `OfflineBooksStatus.tsx`, Offline books screen |

## Tests

- `apps/api/tests/replica.test.ts` runs on PostgreSQL. It covers:
  - the first download, and the copy after a sale, receipt, rename, removal and
    cancellation, each equal to the server's books;
  - matching cursor and checksum;
  - reopening without a download;
  - a damaged copy found and repaired;
  - the offline dashboard and party balance equal to the server's;
  - sales staff refused.
- `apps/native/checks/replica-store.test.js` covers the SQL store on SQLite:
  incremental sync, restart, rollback of a failed write, and offline reads with
  writes refused.
- Browser, with a firm of 2,400 entries:

| Step | Time |
| --- | --- |
| New device: books saved | 2.1 s after Sign in |
| Offline: Parties / Items / Home | 350 / 278 / 56 ms |
| Offline: day book includes a sale saved elsewhere just before | 64 ms |
| Offline: receivables report | 133 ms |
| Offline: a save is refused with the reason | yes |
| Online again: a sale made meanwhile is on screen | 0.33 s |

## Before release

The phone app needs a new native build (EAS), because `expo-sqlite` with
SQLCipher is native code. Expo Go has no SQLCipher. There the key setting is
ignored, so the file is not encrypted; use a development build to test
encryption.

## Limits

- All of a firm's books are held in memory on the phone while the app runs, as
  the server does: about 6 MB of JSON for 2,400 entries. Very large firms (tens
  of thousands of vouchers) will want lazy loading by period.
- Book controls, backups, bank reconciliation changes and documents need a
  connection.

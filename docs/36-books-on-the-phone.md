# 36. Books on the Phone (Local Replica)

Built 13 Nov 2026. The firm's books are always on the device, kept in step with
the server, and readable offline without pressing "Download books".

## Rules

1. **The server is the only place entries are saved.** A save goes to the
   server. The phone's copy changes only from what the server committed, so the
   two cannot disagree. Writing to both places independently would let them
   drift whenever one write failed; that is why the phone never writes its own
   copy.
2. **Screens read the phone, online and offline** (owner decision, 13 Nov
   2026). Parties, items, vouchers, statements, reports and GST returns are
   computed on the phone from its copy, so they open at the same speed with or
   without a connection. Numbering, documents, the edit log, team, backups and
   book controls still ask the server.
3. **Saving needs a connection, and the phone must have caught up.** Offline,
   every save is refused with "You're offline. You need to be online to create
   or update an entry." The form is kept. After the app opens and after every
   reconnect, the first save waits for the sync that brings in what others
   saved meanwhile (banner "Updating your books…"; at most 15 s, then "Your
   books are still updating. Try again in a moment."). Each save returns only
   after the phone holds what was saved, so the screen that refreshes shows it.
4. **Offline window: 7 days.** The phone's books stay readable offline for 7
   days after the last online access check. After that it needs a connection to
   confirm the user still belongs to the firm.
5. **Who gets a copy.** Owner, accountant and viewer get the full copy, because
   their roles read the whole books. Sales staff may not see purchases or costs,
   so they keep the screen-by-screen offline download from doc 17.

## Flow

| When | What happens |
| --- | --- |
| First sign-in on a phone | "Downloading your firm's books… N%". It reads `replica/head` (the change cursor) and every party, item and voucher in pages of 500, then any changes made meanwhile. For 2,400 entries this took about 2 s (10 requests). |
| Every sync | It asks `replica/changes?since=<cursor>` for the records changed since then, and writes them and the new cursor in one SQLite transaction. |
| Sync triggers | A live "changed" notice (about 0.3 s after any save; the screens refresh after the sync), each save made on this phone (before the save returns), opening the app, returning to it, reconnecting, and every 60 s. |
| Checking | After the first download and every 20th sync, a checksum of every row is compared with the server's. A mismatch downloads the books again. |
| Offline | The first failed request (or the browser's offline event) shows "Offline - view only". Book screens keep reading the phone. They are computed by the same `@repo/core` functions the server uses, so the numbers match. |
| Back online | The next answer (a probe every 5 s) ends offline mode and starts a sync at once. Saves wait for it ("Updating your books…"). |
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
| Phone reads, save gate (`phoneFirstServices`, `PHONE_READS`), offline services | `apps/native/src/replica/localServices.ts` |
| Lifecycle, switching and banners | `useReplica.ts`, `DataProvider.tsx`, `OfflineBooksStatus.tsx`, Offline books screen |
| Forms and lists open only for roles the server lets use them (`CREATE_SCREENS`, `READ_SCREENS`) | `apps/native/app/_layout.tsx` |
| Saves don't wait for every open screen to refresh before the form closes | `useServiceMutation` in `apps/native/src/data/scopedHooks.ts` |

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
  incremental sync, restart, rollback of a failed write, offline reads with
  writes refused, and phone-first reads online. Saves pass the gate, and the
  phone holds a new party by the time its save returns. A closed gate stops a
  save before it reaches the server.
- Browser, one device, with a firm of 2,400 entries (16 Nov 2026):

| Step | Time |
| --- | --- |
| New device: books saved (10 requests) | 1.6 s after Sign in |
| Online: Parties / Items / Home, read from the phone | 184 / 97 / 43 ms |
| Online: receivables report / day book, from the phone | 137 / 51 ms |
| Online: book requests sent to the server for those screens | 0 |
| Offline: Parties / Items / Home | 227 / 95 / 47 ms |
| Offline: day book includes a sale saved elsewhere just before | 57 ms |
| Offline: receivables report | 128 ms |
| Offline: a save is refused with the reason | yes |
| Online again: a sale made meanwhile is on screen | 0.2 s |
| Just reconnected: a new party is saved and its screen opens | 0.36 s |

- Browser, four people at once (owner, accountant, sales, viewer, each in their
  own browser): all checks passed, with no page errors.

| Check | Result |
| --- | --- |
| Owner's team screen shows the other three online (live presence) | yes |
| Sales: no purchase rows, no costs in the item list, item purchase history and the phone copy refused (403) | yes |
| Viewer: a sale is refused (403); a link to New sale does not open the form | yes |
| Six sales saved at the same moment by owner, accountant and sales | all saved, bill numbers unique |
| Every user's day book shows all six (over the live connection) | about 0.4 s after the last save |
| Owner, accountant and viewer phones: same entry count as the server after the concurrent saves | 2,460 = 2,460 |
| Accountant offline while the owner saves, then back online | the sale is on screen 0.15 s after reconnecting |
| Owner promotes the viewer; the viewer's next save | accepted |
| Owner demotes them again; their next save | refused at once |

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

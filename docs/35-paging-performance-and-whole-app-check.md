# 35. Paged Lists, Performance and Whole-Application Check

Done 13 Nov 2026 on branch `phase5/access-control`. This doc records:

- how lists are paged;
- what the whole-application check covered;
- the response times measured;
- what was fixed along the way;
- the limits that remain.

## 1. Lists Load a Page at a Time

No list screen loads all its rows in one request any more. The server filters,
sorts and totals each list, then returns pages of 30 with the number of matching
rows and a summary (totals, status counts). The app asks for the next page when
the user scrolls near the end. A **Load more** button is the fallback, and the
end of the list says "All N … shown".

| List | Route | Filters on the server | Summary on every page |
| --- | --- | --- | --- |
| Parties | `GET /v1/parties/page` | type, search, overdue, has balance, sort | you'll get / you'll give |
| Items | `GET /v1/items/page` | search, group, low stock, tax book | count, stock value (0 for sales staff), low stock, groups |
| Sales, Purchase | `GET /v1/vouchers/invoices/page` | month, status, search, tax book | billed, settled, due, count per status |
| Estimates, orders, challans, POs | `GET /v1/vouchers/orders/page` | type, status, search | open value, count per status |
| Day book, journals, banking, a party's entries | `GET /v1/vouchers/page` | types, tax book, party, money in/out, search | total amount |
| Cash/bank and account statements | `…/statement?limit&cursor` | tax book | opening, totals, closing |
| An item's movements | `GET /v1/items/:id/movements` | — | — |
| Edit log | `GET /v1/audit-log/page` | all / changes / cancelled | count per filter (SQL `COUNT … FILTER`) |
| Documents | `POST /v1/documents/search/page` | filters in the body | — |
| Loans, settlements, associates, stock adjustments | existing cursor routes | — | — |

How it works:

- **Shared code.** `packages/core/src/paging.ts` holds the paging helpers and
  `packages/core/src/listPages.ts` the filters and totals. The API and the demo
  books use the same functions.
- **App hook and view.** `useServicePages` loads pages and `PagedView` shows the
  footer. `Screen onEndReached` fires near the bottom, and also when the content
  is shorter than the screen.
- **Cursors.** A cursor is the offset of the page's first row. Because every page
  carries the total, **Download books** asks for all of a list's pages in one
  batch instead of one page after another.
- **Detail payloads.** Party and item details carry only their 20 latest entries;
  the tabs page through the rest.
- **One-answer tables.** Report tables (a row per party or item) and bank
  reconciliation still arrive in one answer, but rows are drawn a screenful at a
  time as the user scrolls.
- **Pickers.** Pickers inside forms still load full lists, in requests of at most
  200 rows. Their sheets are virtualized lists.

## 2. What Was Checked

| Check | Result |
| --- | --- |
| Typecheck and lint, 8 workspaces | 8/8 and 8/8 |
| Unit tests | core 132, app 44, worker 34 |
| API tests on PostgreSQL (paging, roles, cache refresh, batch) | 53/53 |
| Finance acceptance | 10/10 |
| Realtime service on PostgreSQL and Redis | 7/7 |
| System acceptance (5 roles, firm isolation, concurrency) | 14/14; local HTTP p50 24 ms, p95 71 ms |
| Every route at 1280 px and 390 px in Chromium | 140/142. The 2 are the contra form at 0.9 s, showing its header and loading state; the form appears by 2.5 s. |
| Timed run of the full stack (below) | all steps pass, no page errors |

### Timed run setup

The services ran as separate processes on one desktop:

- the API, in development mode with logging at warn level, with Redis and live
  updates on;
- the realtime service;
- the production web export of the app, in Chromium.

The firm was seeded through the real API, using three users at once, in 350 s:
300 customers, 40 suppliers, 150 items, 120 purchases of 10 lines, about 1,550
sales and 300 receipts.

These are local numbers, not EC2 capacity figures.

## 3. Response Times

### API (median and 95th percentile)

A **warm** read is a repeat read with no save in between. A **cold** read is the
first read after a save.

| Read or write | Before this round | Now |
| --- | --- | --- |
| Any list page (parties, items, sales, day book, party entries, movements, statement, edit log) | 14–16 ms | 15 ms (p95 ≤ 30) |
| Sales list page size | 99 KB | 23 KB |
| Dashboard | 191 ms | 32 ms |
| Party / invoice / item detail | 173–181 ms | 15–16 ms |
| Receivables report | 262 ms | 94 ms |
| Stock summary report | 285 ms | 126 ms |
| Sales summary (year) | 179 ms | 31 ms |
| Final accounts | 204 ms | 46 ms |
| Search | 15 ms | 16 ms |
| Repeat read with ETag (304, no body) | — | 15 ms |
| First list page after a save (rebuilds the books once) | 174 ms | 189 ms |
| Next page right after | 18 ms | 19 ms |
| Save a sale | 260 ms | 273 ms (p95 372) |
| Save a receipt | 219 ms | 237 ms |
| 150 party details in one batch request | 1.4 s | 1.4 s |
| Live: pass, connect and ready | 26 ms | 29 ms |
| Live: save → "changed" on another device | 450 ms | 311 ms (the save is about 270 ms of it) |

Core computation benchmark (`packages/core/bench/books.bench.ts`):

| Books | Dashboard | Final accounts | Trial balance | One sale's stock lines |
| --- | --- | --- | --- | --- |
| 5,000 vouchers | 57 ms | 66 ms | 27 ms | 6 ms |
| 25,000 vouchers | 197 ms | 192 ms | 88 ms | 27 ms |

### In the browser (production web build)

| Action | Time |
| --- | --- |
| Sign in → home with the firm's numbers | 1.7 s |
| Open any screen by full page load (app start + data) | 1.5 s |
| Switch tab inside the app | 40–55 ms; first visit to Items 260 ms |
| Scroll to the next page of the day book | 80–200 ms |
| A sale saved by another user appears on this screen | 1.1 s from the start of their save (the save itself is about 0.27 s) |
| Download books for offline (whole firm, every list page) | 24 s, 34 requests |
| Network lost → "Offline - view only" | 0.9 s |
| Offline: Parties tab / Items tab / Home tab | 150 ms / 370 ms / 50 ms |
| Offline: open a party | 0.5 s |
| Network back → live connection restored | 20 ms |
| Network back → sale made meanwhile on screen | 2.8 s, including reopening the day book (≈1.5 s page load) |

## 4. Fixed in This Round

| Problem | Fix |
| --- | --- |
| Lists loaded every row at once | Paging, above. |
| Each read rebuilt the firm's books (about 175 ms) | GET requests share one load per firm data version (`plugins/books-cache.ts`). Writes never use it. In tests the shared books are frozen, so a reader that changes them fails. |
| Read-only POSTs (batch, report export, document search) counted as writes | Marked `readOnly`: no version bump, no live notice. |
| Bottom tabs did nothing when tapped on the web | The tab bar navigates by path (`router.navigate`). It relied on a `navigation` prop that is not passed after the Expo SDK 58 upgrade. |
| Offline on the web went blank on screens not opened yet | SDK 58 loads web routes lazily; `asyncRoutes: false` loads them with the app. Cost: one 3 MB bundle, so a cold page load is about 1.5 s instead of about 0.95 s. |
| Download books stopped at the 25 MB offline limit on this firm | The offline copy leaves out bills' print copies (used only by editing and printing, both online-only) and returnable lines. It keeps one copy of costly filter views (day book, banking, statements for all books; sales for this month and all months). |
| Live notices took about 450 ms | 50 ms merge window in the realtime service, 100 ms debounce in the app. |
| Contra and Banking were blank while the role loaded | They show their header and a loading state. |

## 5. Limits and Next Steps

- **Live update on screen takes about 1.1 s.** The notice itself arrives about
  40 ms after the save. The rest is the refetch: every mounted screen, including
  hidden tabs, refetches at once, and the first read after a save reloads the
  books. Next step: refetch only the focused screen's queries, and mark the
  others stale.
- **The offline copy is one encrypted blob, capped at 25 MB.** The seeded firm
  (about 2,100 vouchers) fits. A firm a little past about 2,500 vouchers will
  not. Next step: split the offline store into several records (by list or by
  month), so the cap applies per record.
- **Web cold load is about 1.5 s** with the single bundle. Next step: keep lazy
  routes and preload every route chunk after sign-in instead. That needs a
  supported way to list the chunks.
- **A save takes about 270 ms.** It reads the books inside the firm lock to check
  stock and numbers. That is correct, and can be tuned later.
- **One existing API test can fail on local reruns** (`data-integrity.test.ts`).
  Each run leaves a due cleanup row behind that the next run's company-wide sweep
  counts. CI starts from a fresh database and is unaffected.
- **Pickers** inside forms still load full lists, at most 200 rows per request.

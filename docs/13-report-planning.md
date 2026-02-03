# 13. Saved Filters and Cash Forecasts

[Documentation index](README.md)

Saved filters and forecast scenarios are local preferences. See
[operational handover](23-release-checklist.md) for deployment responsibilities.

## Implemented

- Named save, load, update and delete controls in Download reports. They preserve
  the report, exact date range, GST scope, account/party selections, narration,
  zero-balance option and PDF/CSV choice. Loading a filter does not run or export it.
- Named forecast scenarios on `/reports/cash-forecast`, including explicit manual
  expected flows. Unsaved form edits are not persisted automatically.
- Device-local persistence in Expo document storage on native and transactional
  IndexedDB on web. Both user and actual firm IDs scope each stored envelope;
  names, versions, IDs, request contents and ownership are validated on read/write.
  Concurrent updates are serialized. Corrupt/unsupported records and failed
  writes surface errors; they are not replaced with empty records or success.
- Limits: 30 saved filters/scenarios per user/firm, 60-character names, 256,000
  serialized characters, 100 manual expected flows and a 366-day horizon.
- A pure forecast builder and validated read-only API endpoint. The API uses the
  existing `inFirm("reports")` guard and repeatable-read report snapshot, including
  archived master labels with deleted opening balances suppressed.
- React Native forecast screen with editable manual flows, overdue policy,
  projected opening/closing, first shortfall, daily balance chart/table, due-bill
  details, excluded exposure, assumptions and book-category reconciliation.
- Real client adapter, scoped mutation hook and demo implementation using the
  same core builder against the existing in-memory demo books. Real mode never
  falls back to demo data.

## Calculation Policy

The opening is cash plus bank **book balances at the end of `asOf`**. It includes
posted activity through that date, not later postings, bank clearing status or
bank credit facilities. The forecast runs from `asOf + 1` through `to`, inclusive.
The as-of date must be within the firm's books and no later than the Indian
business date. Forecasts may cross a financial-year boundary.

`scopeBooks` and `accountBalances` supply the opening balances. `collectionBills`
supplies pending sales/purchase exposure after allocations, TDS settlement,
returns, write-offs and on-account credits. Bills use their recorded due date,
falling back to party credit days. Parties with future opening dates have their
total and GST opening amounts suppressed before calculating exposure.

Overdue means due **on or before the as-of date** for this planning policy.
Default: exclude these bills and show excluded amounts. When explicitly selected,
schedule them on the first forecast day. Bills due after the horizon are excluded
and reported separately. Drafts, cancelled entries and orders are not future
receipts/payments.

Each manual flow has a description, future date, positive whole-paise amount,
in/out direction and explicit GST/non-GST book. These are additional assumptions;
users must not repeat existing due bills or internal transfers. Tax payments,
unbilled income/expenses, loans, refunds and other non-bill flows enter only as
explicit manual assumptions. No forecasts or saved filters create financial
postings or alter allocations.

Mixed forecasts sum the GST and non-GST partitions for every day and total.
Credits offset exposure within their own book rather than crossing books.
Explicit `openingGstBalance` / `openingGstAmount` splits and partial opening-bill
settlements use the shared `scopeBooks` implementation. Legacy
unsplit openings retain its default-book policy. This can deliberately differ
from netting all of a party's credits across both books in an outstanding report.
All financial results are safe integer paise; unsafe totals are rejected. Negative
book balances and projected deficits are retained.

This is a management estimate, not guaranteed collections or a statutory
cash-flow statement. The distinction was checked against the IFRS Foundation's
[IAS 7 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/):
statutory cash-flow reporting describes changes in cash/equivalents classified by
operating, investing and financing activity. This forecast does not claim that
classification or compliance.

## Code Integration

- API: `cashForecastRoutes` is registered in `apps/api/src/app.ts` under `/v1`.
  `POST /v1/reports/cash-forecast` uses the authenticated session and `x-firm-id`.
  Its body is `{ asOf, to, tax, includeOverdue, manualFlows }`. It returns
  `CashForecast`, sets `Cache-Control: no-store`, and maps invalid business
  dates/unsafe amounts to `422 INVALID_CASH_FORECAST`. It performs no write and
  needs no migration, background job or idempotency key.
- Services: `apps/native/src/data/services.ts` includes the real demo builder in
  `demoServices`; `Services` inherits that forecast service type.
  `remoteServices.ts` supplies `cashForecastService(client)` with the shared
  authenticated, firm-scoped client. Real mode has no demo fallback.
- Hook: `cashForecastHook.ts` delegates to
  `services.cashForecastService.forecast(input)` through the scoped mutation
  helper, retaining permission checks and late-response isolation.
- Navigation: `apps/native/app/settings/index.tsx` links Download reports to
  `/settings/reports` and Cash forecast to `/reports/cash-forecast`, both guarded
  by `reports`. Expo Router discovers both screen files; the forecast also guards
  direct navigation. Named saved-filter controls are integrated in Download
  reports, and named scenario controls are integrated in the forecast screen.
- Related book review wiring is also present: `openingAllocationRoutes` and
  `yearEndRoutes` are registered in `app.ts`; `Services.bookControlService` and
  its remote adapter expose allocations, allocate, yearEnd and closeYear;
  `bookReviewQueries.ts` uses scoped service hooks; `/settings/books` links to
  `/settings/opening-allocations` and `/settings/year-end`. Demo book controls
  require sign-in rather than pretending to save.

Direct core/contracts subpath imports are intentional. Forecast barrel exports
remain optional and are not missing integration work. The core module exports
`buildCashForecast`, `CashForecastInputError`, `ExpectedCashFlow`,
`CashForecastRequest`, `CashForecastTotals`, `ForecastBill` and `CashForecast`;
the contracts module supplies its request/flow/totals/response schemas and types.
The forecast stays separate from `REPORT_IDS` and the actual-report `buildReport`
dispatcher.

## Historical Openings

Openings use their effective dates in statements and forecasts. Review before,
on and after-date balances in each book scope; downloaded running balances must
follow the same chronology. Opening adjustments do not create financial vouchers.

## Manual Checks

On staging, save a report filter and forecast scenario, reload and confirm the
selected firm, dates and scope remain correct. Compare cash/bank opening values
and expected flows with the source books, including overdue amounts and signed
adjustments. Review local persistence after restart on intended devices.

## Limits

- Saved filters/scenarios are local to this installation/browser, not synchronized,
  centrally backed up or shared between teammates. Exact saved dates do not roll
  forward automatically. Signed-out users cannot load them; records remain for
  their original user/firm on later login. Automatic logout erasure and corruption
  recovery/reset UI are not implemented here.
- No forecast PDF/CSV export, automated collection probabilities, linked loan/tax
  schedules, statutory cash-flow classification or automatic financial posting.
  Existing actual-report PDF/CSV export remains available in Download reports.

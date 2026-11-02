# 14. CSV Imports

[Documentation index](README.md)

Customer/supplier/item imports are integrated. The financial
extension implements monetary openings, opening-bill allocations and opening
stock lots through the same API, contracts, parser and native screen.
Shared bill hydration, settlement targets and book partitioning are implemented.
Backup v4 includes the financial import records and their restore mappings.

## Behavior

- Masters: owner/accountant, new records only. No updates, merges, skipped
  conflicts or partial success. Master imports still create zero openings.
- Financial kinds: owner only, including template, preview, confirmation and
  replay. Financial imports initialize cutover books, not active history.
  Approved openings, any closed period or any posted voucher block new imports.
- UTF-8 CSV uses installed `csv-parse@7.0.3`, injected from `app.ts`.
  No production parser fallback exists.
- Preview returns row/field errors and formula-safe error download. Financial
  preview also returns GST, non-GST and mixed reconciliation totals.
- Apply requires `confirmed: true` and a UUID `Idempotency-Key`. A 15-minute
  signed preview binds exact file bytes, kind, actor and firm. Financial previews
  additionally bind a digest of the checked opening state.
- Confirmation reparses and revalidates under `withFirmWrite`. Membership,
  profile and relevant master/control rows are locked. Changed financial state
  returns a non-applicable preview; no rows are saved.
- All changes, book-control history, sync notifications and durable receipt
  commit together. Any failure rolls back the entire import.
- Committed requests replay after restart or preview expiry, after authorization.
  Reusing a key with another preview fails. Reusing a committed preview with
  another key returns the original receipt. Receipts are not purged with the
  voucher retry cache.
- No paths/URLs are fetched and no CSV content is executed. Responses are
  private/no-store, bounded and rate limited.

## CSV Rules

Comma delimiter, double-quote escaping, UTF-8 with optional BOM. Quoted commas,
escaped quotes and embedded newlines use the established parser. Every template
column is required, in any order. Unknown/duplicate headers and blank records
are errors. Record numbers include the header; quoted multiline records count
once, not once per physical line.

Limits: 256 KiB UTF-8, 500 data records, 20 columns, 500 characters per cell,
16 KiB parser record buffer and 250 returned errors. Truncation is explicit and
never permits partial application. Parser failures do not echo source text.

Money is decimal rupees converted exactly to whole paise. Scientific notation,
grouping separators, extra whitespace and more than two decimals are rejected.
Financial amounts, unit costs and individual lot values are capped at
1,000,000,000,000 paise. Only monetary-opening amounts/GST shares may be negative.
Quantities are base units with at most three decimals and shared quantity caps;
per-item aggregate quantities are checked too.

Templates are header-only. Exported cells are quoted and formula-like leading
`=`, `+`, `-`, `@`, tab/newline values receive an apostrophe. Error exports contain
record/field/code/message, not source rows. Phone/code/bill/lot values remain
strings. Export these spreadsheet columns as text to preserve leading zeroes.

### Masters

Customers/suppliers:

```csv
name,phone,city,stateCode,gstin,creditDays,creditLimit
```

Items:

```csv
name,code,hsn,group,taxType,gstRate,unit,purchasePrice,salePrice,mrp,reorderLevel
```

Shared Zod/core checks cover state/GSTIN agreement, HSN requirements, enabled
units, prices/MRP and precision. Duplicate names/codes are case-insensitive;
GSTIN duplicates are checked within party type. Code case/zeroes are preserved;
outer code whitespace is rejected. Blank optional numbers become zero; sale
price and GST rate are required. Opening columns in master files remain invalid.

### Monetary Openings

Kind: `opening-balances`.

```csv
targetKind,targetId,date,amount,gstAmount
```

`targetKind` is `party`, `ledger` (cash/bank) or `account` (custom account).
`targetId` is an existing master UUID in this firm. Date must equal the firm's
financial-year start and cannot be future-dated. Amounts are positive debit,
negative credit; for parties, positive means they owe the firm.
`gstAmount` is the signed GST-book share, not tax charged, with the same sign
and no larger magnitude. Non-GST is the difference.

Only zero openings without explicit allocation or imported provenance can be
initialized. Repeated targets are errors. The existing fields are updated and
an immutable `imported_opening_balances` row records batch, target, date and
amounts. Legacy string-key opening accounts are not targets; use an existing
custom account.

Preview totals describe this batch: debit, credit, net and opposite capital
offset in each book, following existing opening accounting. No journal or GST
turnover is created. Importing does not automatically approve opening books.

### Opening Bills

Kind: `open-bills`.

```csv
partyId,number,date,dueDate,amount,gstAmount
```

These rows partition an existing party opening, without invoices, postings,
turnover, input tax or stock. Import monetary openings first if needed.
All opening bills for an included party must be in one file, exactly matching
its net opening and GST-book share. Positive bill amounts support customer debit
and supplier credit openings. Advances/opposite-direction openings and gross
debit/credit netting within a party are rejected, not guessed.

Bill date cannot follow party opening date; due date cannot precede bill date.
Opening date controls historical visibility; original bill/due dates control
ageing. Case-insensitive duplicate numbers within a party, existing partitions
and wrong-firm parties are errors.

Immutable `opening_bills` rows contain `id, firmId, batchId, partyId, number,
date, dueDate, openingDate, amount, gstAmount, createdAt`. Settlement identity:
`opening-bill:<id>`. These replace, never append to, the synthetic
`opening:<partyId>` bill. The party's monetary opening remains the sole ledger
opening. Per-bill shares feed cumulative whole-paise settlement rounding.
Preview bill totals are subledger allocations, not added debits/credits.
Database triggers reject updates/deletes of bill and monetary-provenance rows.
Party responses carry read-only `openingBills`; party input cannot set them.
Reports, party detail/list, sync and voucher snapshots hydrate this metadata.
Receipt/payment validation checks the party, cutover visibility and remaining
balance. Ordinary and signed settlement allocations persist an exclusive
`openingBillId` FK, never a fabricated voucher ID.

Single-book correction/writeoff/reversal journals hydrate signed bill deltas.
These change pending amounts without rewriting the opening partition. Subsequent
receipts use the remaining book shares, preserving whole-paise reconciliation.
The existing settlement workflow rejects cross-book/TDS allocation corrections;
split opening bills remain payable through normal receipts/payments.

### Opening Stock

Kind: `opening-stock`.

```csv
itemId,lotNumber,date,bookScope,quantity,unitCost
```

`itemId` is a live item UUID; date is financial-year start. Scope is `gst` or
`nongst`; quantity is positive and cost nonnegative. Case-insensitive repeated
lot labels within an item are errors. Existing opening stock/lots or a previous
stock-import receipt prevent another initialization. Multiple new lots for an
item belong in one batch.

Each lot gets a stable UUID and persists in `items.opening_lots` as
`{id,qty,unitCost,bookScope}`. `openingStock` is summed quantity;
`openingCost` is a weighted legacy fallback. Lot-specific costs/scopes remain
authoritative. Valuation follows stock replay's whole-paise
`round(qty * unitCost)` rule. GST plus non-GST values equal mixed values.
Stock adds an opening asset and capital offset, not a purchase or GST claim.
Lot labels/dates and item IDs remain in receipt `stockLots` metadata.

## Wiring

Contracts, the actual parser and routes in `app.ts`, native remote service and
Settings navigation are wired. Both native and web file-save allowlists accept
all six import kinds. The owner-only Openings screen includes reconciliation,
errors, explicit confirmation and the stable request-key retry path.

The same endpoints handle masters and financial kinds:

- `GET /v1/imports/template?kind=...`
- `POST /v1/imports/preview` with `{kind,text}`
- `POST /v1/imports/apply` with `{kind,text,previewToken,confirmed:true}` and UUID
  `Idempotency-Key`, using normal authenticated firm headers.

Keep the signing secret consistent across instances. Rotation invalidates old
preview tokens, including tokens used to retrieve committed receipts.

Migration 0015 supplies durable import receipts. Inventory migration 0017
supplies `items.opening_lots`. Registered migration 0021 adds immutable opening
tables, financial receipt kinds, imported-master guards and allocation targets.
Both `allocations` and `settlement_allocations` have nullable
`opening_bill_id uuid REFERENCES opening_bills(id) ON DELETE RESTRICT`, a
`(firm_id, opening_bill_id)` index, and a check requiring exactly one of
`bill_id`, `opening_party_id`, `opening_bill_id`.

Imported-master guards take the firm lock and reject total/share/date/type
changes, imported stock/lot/unit rewrites and deletion. Ordinary labels remain
editable. Stock provenance is read from durable receipts. Parties also return
domain errors before attempted deletion or bill-partition changes.

Backup v4 includes both opening tables, both allocation targets, opening lots
and financial receipts. New-firm restore remaps batch/target/party/bill/lot IDs,
receipt `createdIds`, reconciliation party IDs and receipt lot metadata.

## Manual Checks

On staging, preview a small CSV for each required import kind. Review signed
amounts, opening dates, bill partitions and lot metadata before confirming.
Compare imported balances and stock in all book scopes, then reload the app.
Verify that invalid rows or stale previews leave the books unchanged.

Uploaded numeric values retain their signs; CSV formula-safe download escaping
must not be applied to imported numeric fields. Check native file selection and
explicit retry behavior on the intended devices.

## Boundaries

No silent updates, active-book opening rewrites, automatic approval, partial
bill partitions, opposite-direction bill netting, alternate-unit quantities,
XLS/XLSX, mapping wizard, background imports or history UI. Immutable opening
partitions have no edit/delete endpoint; settlement corrections use their
separate audited workflow. Client retry state does not survive process death;
server receipts do.

## Reminder and Conflict Handling

- The [notification reader](../packages/backend/src/modules/notifications/notifications.repo.ts)
  hydrates imported `openingBills`, including original due dates and book shares.
  Settled imported bills no longer inherit the party's aggregate overdue age.
- [Database error translation](../apps/api/src/lib/book-errors.ts) maps `P0021`
  to `409 IMPORTED_OPENING_IMMUTABLE` through wrapped HTTP and sync failures.
  Reopening a period does not unlock an immutable financial import; use an
  audited correction as the response explains.

These repairs were checked on 26 October 2026; see F08-F09 in the
[private-use audit](27-private-readiness-audit.md). Deployed reminder preparation
and device acceptance remain separate checks.

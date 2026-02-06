# 05. GST, Non-GST and Mixed Books

[Documentation index](README.md)

Hisaab supports GST, non-GST and mixed bookkeeping. These categories organize
recorded activity; the application is not a GST filing product.

## Entry Workflow

1. Create one item master for a product. Its buying/selling rates are defaults, not historical valuation rates.
2. On a purchase, tick **Purchase without GST** for a non-GST entry. Each purchase line creates a stock lot with its own date, cost, quantity and book category. A GST purchase and a non-GST purchase of the same product remain under the same item.
3. On a sale, select **Stock lot** for each item row. The picker shows purchase number/date, category, remaining base-unit quantity and acquisition cost. Add another row to sell from another lot, even for the same item.
4. A sale containing both categories asks **Create two invoices?**. Confirming saves both invoices in one database transaction. Neither bill, receipt, stock movement nor invoice number is left partially saved if the operation fails.
5. The result links to the second invoice. Both invoices can be viewed, printed, shared, settled and returned independently. Selected attachments are associated with both invoices; attachment transfer retries remain separate from financial saves.

GST-category entries follow the firm's existing tax mode and the item's normal tax treatment. Non-GST-category entries carry no GST. The book category is not a determination of legal GST exemption or credit eligibility; mixed reports keep all recorded business activity visible.

## Numbering and Payments

- Existing invoice series are retained. With the default prefixes, GST sales use `SI/26-27/0001`, non-GST sales use `NSI/26-27/0001`, purchases use `PI`, and non-GST purchases use `NPI`. The non-GST prefix is `N` plus the configured base prefix. Each series has its own financial-year counter.
- A mixed sale's payment received now settles the GST bill first, then the non-GST bill. Excess payment is rejected. A later receipt can allocate money across both bills.
- Each split invoice is rounded independently. The form shows their combined rounded total, not a differently rounded combined invoice.
- Freight/extra charges entered on a mixed sale go on its GST bill. This is an explicit convention, not proportional allocation. Create two separate forms when charges need a different distribution.
- A saved bill keeps its category and number during edits. Changing category requires cancellation and recreation, subject to stock/settlement protections.

## Stock and Costing

- New sales use selected-lot cost. The server checks ownership, purchase date, available quantity and repeated rows, and derives cost/category itself. Client-provided costs are not trusted.
- Firm-level write serialization prevents simultaneous sales consuming the same remaining units. Backdated entries are checked against later committed stock use too.
- Sales returns restore the original lot and cost. Purchase returns remove their original lot; unavailable stock cannot be returned. Consumed purchases cannot be edited/cancelled until dependent entries are resolved.
- Opening inventory supports multiple lots with distinct quantities, costs and categories under one item. Changing the default purchase price does not revalue historical stock. Opening stock/cost/category are locked once the item is used.
- Lot cost includes the purchase line's discount and non-recoverable tax under the existing firm tax-mode model. Extra purchase charges remain period expenses until explicitly capitalized through the landed-cost action; the application does not automatically distribute freight across purchases.
- Invoice forms accept quantities with up to three decimal places, matching the shared engine and API. The base unit and pack conversion are retained per line.
- Legacy sales without a lot selection replay FIFO within their inferred category. This is a compatibility estimate, not reconstruction of the original physical stock choice. Existing shortages remain visible, not silently erased.

## Reports and Accounting

**Mixed / GST / Non-GST** selects the bookkeeping category on Home, report screens, accounting, final accounts, stock lists, daybook and account/ledger drilldowns. The shared selection is scoped to the current user and firm. Download settings offer the same categories for all 19 existing PDF/CSV reports; exported titles and filenames identify the selected category.

Receipts/payments are divided according to the bills they settle, including proportional cash/TDS attribution where applicable. Unallocated amounts and manual journal, expense, contra and financing entries use their selected category. A receipt allocated across both categories therefore appears as the appropriate portion in each scoped report, and once in Mixed.

Monetary openings use their reviewed GST share and the non-GST remainder. Without
an explicit allocation, they default to GST for registered firms and non-GST for
unregistered firms. Opening stock uses each lot's saved category; nothing is
duplicated into both books. Owners review allocations and approve openings in
[Book controls](08-opening-year-end.md).

P&L uses explicit period boundaries and historical opening/closing stock, sharing its calculation with exports. Balance sheets retain cumulative earnings and show opposing counterparty balances separately. Dashboard tax includes returns. GST screens show book estimates only; filing deadlines, eligible ITC, carry-forward portal balances and actual tax payment confirmation are not promised.

Bank reconciliation now has a real read endpoint and native adapter. Bank-to-bank transfers clear independently per bank, and a later clearing date does not clear an earlier as-of report. Reconciliation represents actual bank accounts; the category reports are analytical views of those accounts.

## Migration and Local Setup

The stock/book migrations do not require additional application environment variables or R2 keys.

- `0008_stock_lots_books.sql` adds book/lot fields and freezes each existing item's current purchase price as the best available opening cost. Already-issued voucher amounts, tax lines and serial numbers are not rewritten.
- `0009_bank_clearing_legs.sql` adds per-bank clearing dates. An old clearing date is preserved on one bank leg, never assumed to clear both sides of a transfer.
- Before an upgrade, verify a database backup and pause API/worker writes. Run `bun run --cwd apps/api db:migrate` from the repository root, then start the updated processes. Restart Expo to load the updated application bundle.
- Historical opening costs that were already wrong before this migration cannot be recovered automatically. Review those balances before live migration.

## Inventory Corrections

The inventory register and quick-create drawer link to counts, damage/shortage and
landed-cost entries. A correction targets one stock lot, checks its expected
quantity/value under the firm write lock and retains the reason and audit trail.
It must follow the item's latest stock movement, so it cannot silently change an
already issued sale's cost. Quotes and unfulfilled orders are not stock movements.

Counts enter the actual remaining base-unit quantity. Damage enters the quantity
lost. Financial corrections retain the lot's GST/non-GST classification and
balance purchase-cost adjustment against Stock Loss/Stock Surplus. Zero-value
stock still accepts quantity corrections: its audited voucher has no invented
financial lines. Landed cost increases only stock still on hand and credits an
explicit cash/bank or expense source. Returns blend original frozen return cost
with the remaining lot's value, including later cost additions.

Reversal appends the original opposite quantity/value and financial lines; it does
not erase history. Later movements on that lot must be resolved first. Direct
editing/cancellation of managed stock journals is refused. Private entry images
use the existing attachment pipeline, including durable pending saves.

Migration `0017_inventory_controls.sql` adds opening lots and inventory adjustment
snapshots. Apply all current migrations after a verified backup; do not seed or
schema-push existing books.

## Boundaries and Remaining Work

- Partial and mixed-category source orders now convert through the [fulfillment workflow](./11-order-fulfillment.md), preserving line quantities and frozen references.
- Multi-warehouse transfers and automatic freight distribution are not part of this single-stock-register implementation. Use explicit per-lot landed-cost allocations.
- Opening approval, period close/reopening, financing and financial imports have separate module guides; see the [module guide](03-backend-modules.md) and [operational handover](23-release-checklist.md).

## Manual Checks

On staging, purchase the same item into GST and non-GST lots, sell from each and
review a mixed sale. Confirm separate numbering, selected-lot cost, quantities,
returns and additive scoped balances. Compare reports and printouts after restart.
Review historical issued values before and after applying migrations.

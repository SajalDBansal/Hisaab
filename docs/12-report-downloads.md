# 12. Accounting Report Downloads

[Documentation index](README.md)

Open **Settings > Business > Download reports**, or the download icon on
**Accounting**. Select a report, financial year/preset or custom dates, and an
account or party where applicable. Preview and download use the same report
document. Downloads always read the latest committed books.

## Reports

- Trial balance with opening, period debit/credit and closing debit/credit.
- Balance sheet as at the selected date.
- Profit and loss for the selected period, including stock and returns.
- Daybook with all double-entry postings and the journal-only register.
- General ledger, cash book and bank book: all accounts or one account, with
  brought-forward opening balances, chronological entries and running balances.
- Sales and purchase registers, including negative credit/debit notes.
- Separate credit-note and debit-note registers with original bill references.
- Receipt and payment registers, with cash movement, TDS and party settlement.
- Expense summary, including expenses posted through journals and purchases.
- Receivables and payables ageing as at the closing date.
- Stock quantities and values by item/group, without adding unlike units.
- GST and TDS account balances and period movements.

## Files and options

- PDF: A4 portrait/landscape chosen by the report width; repeated table headers.
  Browser PDFs preserve Unicode text through rasterization and include page numbers.
- CSV: UTF-8 with a BOM for Excel, rupee amounts with two decimals, quoted cells,
  and formula protection for user-supplied text. This is CSV, not an XLSX workbook.
- On Android/iOS, the system share sheet offers Files, Drive, email and other
  installed destinations. On web, the file downloads directly.
- Narration can be omitted. Inactive accounts and zero-stock items can be included.
- Reports include firm identity, date scope, currency, generation time and notes.
- Exports over 20,000 rows are rejected instead of truncated. PDF exports over
  5,000 rows ask for CSV or a smaller selection.

## Accounting rules

- Only posted financial vouchers affect monetary totals; drafts, cancellations
  and estimates/orders do not. Stock includes unbilled delivery notes.
- Ledger opening balances include activity before `from`; P&L includes only
  activity from `from` through `to`. Balance sheet and ageing are cumulative
  through `to` and are labelled "As at".
- Returns reduce the register in the return's posting period, not the original
  invoice period. Registers retain the party name/GSTIN saved with each invoice.
- TDS withheld is separate from cash paid. Journals for loan principal, capital
  and interest follow their account groups rather than treating loans as income.
- Later receipts do not clear a bill in an earlier ageing report. A delivery note
  remains a stock movement until its invoice is present at that report's cutoff.
- Stock valuation replays historical opening/purchase lots and inventory
  adjustments through the selected date. Sales use saved selected-lot costs;
  legacy sales without a selection use the documented FIFO fallback. Changing
  an item's default purchase price does not revalue recorded lots. See
  [stock and costing](05-stock-books.md#stock-and-costing).
- Tax ledgers are not statutory GST returns, input-credit eligibility checks or
  portal upload files. The firm's opening balances and posted adjustments still
  determine the accuracy of its financial statements.

## API and checks

`POST /v1/reports/export` accepts `ReportRequest` and returns `ReportDocument`.
It requires an authenticated firm member, uses `Cache-Control: no-store`, and loads
books in a repeatable-read, read-only database transaction. Filters are validated
against that firm; deleted master records remain available for historical reports.
All monetary calculations stay in integer paise until file rendering.

On staging, compare a downloaded report with its on-screen totals for the same
firm, dates and book scope. Check CSV signs/paise, PDF pagination, long names and
empty results. Confirm access remains limited to the selected firm and role.

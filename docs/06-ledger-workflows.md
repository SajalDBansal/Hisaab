# 06. Ledgers, Journals and Payment Reminders

[Documentation index](README.md)

## Where to Start

Open **More > Accounting > Entries** for **Ledgers & journals**.
The **+ / Create** drawer also opens **Journal**, **Loan / capital** and
**New ledger** directly, plus **Document** for a standalone attachment.

- **New ledger** creates capital, secured/unsecured loan, loan-given, fixed asset,
  other asset/liability, provision, expense or income accounts. Cash and bank
  accounts use their existing ledger master. Customers and suppliers keep their
  existing party forms and bill tracking.
- Opening balances are signed Dr/Cr balances at the start of the books, not new
  money received today. Opening capital remains the existing balancing figure.
- **Loan / capital** creates ordinary, audited journals for borrowing, principal
  repayment with interest, interest paid/accrued, capital introduced/withdrawn,
  loans given and recovery with interest.
- **Journal** remains available for arbitrary balanced adjustments, including
  parties and the new ledgers. Zero-balance masters are now selectable.
- Statements, cash/bank balances, trial balance, expense reports, P&L and balance
  sheet include these postings. Cancellation uses the existing voucher flow.

## Principal and Interest

A loan received debits cash/bank and credits the loan ledger. Repayment debits
principal to that ledger and current interest to Interest Paid, crediting the
total to cash/bank. Accrued interest debits Interest Paid and credits the loan.
For legacy interest accrued into the loan balance, **Pay already accrued interest**
clears that liability without another expense. A combined repayment's loan-account
reduction may include that accrued amount; it is not necessarily pure principal.
Capital contributions do not become sales, and loan principal is not an expense.

This financing form takes explicit amounts. The separate [loan register](10-loan-register.md)
provides fixed-principal and EMI projections, dated rate resets, reviewed repayment
splits and managed interest with linked settlement. Its projections do not post
journals: each actual interest posting requires review. Automated tax treatment
and unattended posting are not included, and this is not full Tally feature parity.

Custom-account creation is supported by the [offline outbox](17-offline-books.md).
The account becomes selectable after the server confirms it; dependent offline
entries cannot refer to a fabricated new account. Custom-account edit/delete
endpoints are not supplied.

## Paid Bills and Allocation

Two receipts can clear a customer's net balance without being linked to an invoice.
Collection views and reminders now account for those credits, while the bill view
continues to show the actual saved allocations.

On the party page, **Allocate payments** links unused receipts/payments to the
oldest open bills after confirmation. It preserves payment amounts, cash balances
and existing allocations, writes an audit entry, and updates voucher versions and
sync records inside the same firm transaction. A retry is a no-op once allocated.

New receipt/payment forms allocate oldest-first by default. **Keep as advance**
explicitly leaves the payment on account. Cancellation makes the corresponding
amount collectible again. Opening advances and future-dated payments are excluded
from historical bill debt and collection exposure respectively.

## Reminders

Reminder buttons request the current firm's real balance and message from
the API. A paid customer cannot be reminded. Settings and last-sent dates persist.
Phone links preserve explicit country codes and use +91 for local ten-digit
numbers. Missing numbers use the share sheet; errors are shown in the app.

WhatsApp opens a prepared message. The user sends it and confirms **Mark sent**.
Opening a chat alone does not record delivery. Automatic WhatsApp Business API
delivery and provider delivery receipts are not implemented.

## API and Deployment

- `GET/POST /v1/accounts/masters`: firm-scoped masters; creation needs `accounts`
  permission and supports `Idempotency-Key`.
- `POST /v1/parties/:id/allocate-payments`: uses sales/purchase permission for the
  party type and the same firm lock as voucher posting.
- `GET /v1/parties/:id/reminder`, `POST /v1/parties/:id/reminders`: prepare text and
  record user-confirmed sending, requiring sales permission.
- `GET/PATCH /v1/settings/reminders`, `GET /v1/reminders/due`: persistent rules,
  requiring settings permission for updates.
- Existing journal, account statement and report routes remain the read/write
  interfaces for financial entries.

Apply migration `0006_account_masters.sql` with `bun run --cwd apps/api db:migrate`
using the existing `DATABASE_URL`, then rebuild/restart the API and reload Expo.
The migration adds account masters and their sync trigger; it does not reallocate
old receipts. No additional database environment variable is required.

On staging, post and allocate a receipt, inspect the related ledger and reminder
amount, then reload. Confirm paid bills are excluded and closed-period writes
are rejected.

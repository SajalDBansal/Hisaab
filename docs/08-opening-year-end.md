# 08. Opening Allocation and Financial-Year Review

[Documentation index](README.md)

## Opening balances

Settings > Book controls > Opening allocations lets the owner assign the GST
share of each party, cash/bank, custom account or legacy account opening.
The non-GST share is the remainder. Both shares keep the total's debit/credit
sign. The combined balance and automatic capital offset are unchanged.

An unset allocation retains the firm's original default book. Restore default
before changing a master opening total. Stock openings retain their existing
item/lot book classification; this editor does not split an opening stock lot.

Allocation changes require all periods and openings to be reopened, a reason,
the current version and a matching review digest. Every change remains in the
append-only book-control history. Approved opening allocations are also protected
by database triggers and signed-range constraints.

Partial receipts/payments against an opening use cumulative whole-paise rounding
in date, creation-time and ID order. Cancelled entries do not consume a share.
Each GST/non-GST statement reconciles to the mixed statement.

Historical reports exclude party openings later than their cutoff. Openings added
inside a downloaded ledger period appear on their actual date with an opposite
capital adjustment, clearly distinguished from vouchers. Party balances, ageing,
Home totals, trial balances and balance sheets use the same date boundary.

## Financial years

Settings > Book controls > Financial year review shows all three trial balances,
P&L, balance sheets, outstanding amounts and stock carried forward. The owner
reviews all books, enters a reason and closes the completed financial year.

Closing is blocked for unapproved openings, unfinished/already-closed years,
unposted drafts, negative stock histories and unbalanced statements. A changed
review must be reloaded before closing. Idempotent retries do not create another
close event.

This uses continuous books: closing locks through 31 March and records the
reviewed figures. It does not overwrite the original books-start date, duplicate
opening journals or detach outstanding bills and inventory lots. Reports for the
new year start income/expense movement afresh while retaining cumulative capital.
Period reopening remains the explicit owner-controlled correction path.

Continuing within the same company is also an established year-transition option
in [Tally's financial-year guidance](https://help.tallysolutions.com/moving-to-the-next-financial-year-india-change-current-period/).
This feature is a management-book review, not statutory tax filing or an auditor's
approval.

## Deployment

Migration `0013_opening_allocations.sql` adds nullable allocation fields without
reclassifying existing balances. Apply reviewed migrations through the normal
deployment process. The application must not run new code against an unmigrated
database. Use staging books for manual opening-allocation and year-end review.

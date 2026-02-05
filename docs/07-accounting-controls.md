# 07. Opening Balances and Period Controls

[Documentation index](README.md)

The owner uses **Settings > Book controls**. The API also allows accounts
users to read the review, but only the owner can approve, close or reopen books.
This is a bookkeeping control, not GST filing or statutory certification.

## Review openings

1. Reconcile party, cash/bank, stock, custom-account and other opening balances to
   the previous books. Review both debits and credits.
2. Inspect the calculated capital offset. This was already part of the accounting
   engine; approval now makes its acknowledgement explicit. It is not proof that
   the imported balances are correct, and should not conceal an unexplained difference.
3. Enter a review note of at least ten characters and approve the figures. A digest
   rejects approval if the reviewed balances changed while the screen was open.

Approval freezes financial opening fields, including relevant account classifications,
and the firm's GST classification/financial-year basis. New zero-opening masters
and ordinary contact-detail edits remain allowed. Correcting openings requires the
owner to reopen all periods first and then reopen opening balances, with reasons.

Owners can split monetary openings between GST and non-GST books and review a
financial-year close from the same settings area. See
[opening allocation and year-end review](08-opening-year-end.md). Closing uses
continuous books; it does not create duplicate opening journals.

## Close or reopen a period

The closing date is inclusive. After closing through 31 March, new entries dated
31 March or earlier are rejected. Editing or cancelling an old entry cannot bypass
the lock by changing its date. Offline replay is subject to the same controls and
returns an explicit conflict instead of silently saving an old transaction.

To make a correction, the owner records a reason and moves the lock to an earlier
date or reopens all periods. Make the correction, reconcile the reports and close
again. Reopening itself never changes an amount, stock movement or allocation.

Control events store the actor, time, reason and before/after state. Database
triggers reject changing or deleting those events. The UI shows the latest 100;
the complete history remains stored. Control history is separate from voucher
edit history, whose API adapter now follows all pages.

This follows the common transaction-lock model of restricting older writes with
an explicit reopening step. Our owner-only permission and opening review are
application design choices. [Zoho transaction locking](https://www.zoho.com/in/books/help/accountant/transaction-lock.html).

## Interest already accrued

In the financing-entry screen, use **Pay already accrued interest** when an earlier
entry already recorded the expense against the selected loan account. This debits
that loan liability and credits cash/bank. **Interest paid** is for an expense not
already accrued. Selecting the wrong action can duplicate the expense.

The separate [loan register](10-loan-register.md) supports repayment schedules,
reviewed allocations and managed interest in dedicated interest accounts. Settle
those accruals through their linked payment/recovery action, not this legacy
loan-account interest shortcut.

## Deployment

Review pending migrations, including 0010-0012, and back up the database before running
`bun run db:migrate` from `apps/api`, then restart the API/worker and Expo. Old API
processes must not continue writing after deploying these controls.

On staging, review and approve openings, close a period, confirm a backdated
write is rejected, then explicitly reopen it with a reason and review the history.

# 10. Loans, Interest and Settlements

[Documentation index](README.md)

The loan register and settlement workflows are integrated with the API, schema,
native services, router and Settings navigation. They provide real journal-backed
advances, refunds, write-offs, corrections, credit approvals and explicitly
confirmed interest postings.

## Implemented

- Borrowed loans use existing `Secured Loans` / `Unsecured Loans` accounts. Lent
  loans use existing `Loans & Advances (Asset)` accounts. One register entry per
  dedicated account, including closed loans; the account and direction are immutable.
- Contract reference, counterparty, note, original principal, annual rate in integer
  basis points, start date, first due date, 1-600 installments and derived maturity.
- Model `fixed-principal-monthly-v1`: regular principal is `floor(P / n)` whole
  paise; the last installment receives the remaining principal. Each month's
  interest is `roundHalfUp(openingPlannedPrincipal * annualRateBps / 120000)`.
  The first period is also one twelfth of a year, regardless of the gap from start
  to first payment. This legacy model remains unchanged; new registrations can
  choose the additional models and interest bases described below.
- Due dates retain the first due date's day of month, clamped to each month's
  last day without drift (Jan 31, Feb 28/29, Mar 31). A Feb 28 anchor stays on the
  28th; it is not an implicit end-of-month convention. Maturity is the last due date.
- Pure BigInt intermediate arithmetic, half-up rounding, safe integer results,
  final remainder and schedule validation. Terms never create postings.
- Posted balance is the existing general ledger's signed Dr-positive account
  balance, across all books, including opening balances and all posted movements.
  It is not a computed outstanding-principal figure and may contain manually
  accrued interest. Planned principal and interest remain distinct on every screen.
- Repayment references link an entire existing posted finance journal to one
  installment. Amounts are derived from the journal, never typed as a new payment.
  Borrowed repayment: loan Dr, optional `expense:Interest Paid` Dr, cash/bank Cr.
  Lent recovery: cash/bank Dr, loan Cr, optional `income:Interest Received` Cr.
  Uses the existing `financingLines` helper to validate exactly these legs.
  Separately expensed interest-only journals, accruals, extra legs and split
  journals are outside this reference workflow; they still affect the ledger.
  **Existing journals cannot distinguish principal-only repayment from settlement
  of interest previously accrued into the same loan account.** Candidates expose
  `accountReduction` and `separatelyPostedInterest`. The default remains an
  explicitly confirmed all-principal reduction. A reviewed split can instead
  identify positive principal and previously accrued interest, as described below.
- Multiple whole journals can reference an installment. A journal has at most one
  live reference. References can differ from contractual amounts: totals are
  labelled referenced amounts, not proof that an installment is settled. There
  is no inferred overdue amount or automatic reduction of future planned interest.
- References retain original journal number/date/version/amounts and a note.
  Changed, cancelled or missing journals are visible but excluded from referenced
  totals. Remove with a reason, then link the reviewed replacement. Removal does
  not alter the voucher. Removed references and audit events remain visible.
- Owner/accountant writes, viewer reads, sales denied. Mutations recheck current
  DB membership under the existing firm advisory lock before idempotency replay.
  Every mutation requires `Idempotency-Key`; edits and references also require the
  displayed loan version in `If-Match`. Linking also checks the displayed journal
  version. The idempotency hash includes firm, method/path, body and loan version.
- Repeatable-read details/lists, strict cursor validation, full paged history,
  append-only audit events with actor, before/after snapshots and reasons; SQL
  triggers enforce tenant/account-group relationships and immutable audit history.
- Creation checks the loan start against closed periods. Changing principal,
  tenor, dates, initial rate, model or basis checks both old and new starts and is
  blocked after reference/interest history, including removed/reversed entries.
  Future-only rate revisions preserve protected periods and check the current
  open period. Metadata/status changes check the current Indian business date.
  Linking checks the journal date and current date. Removal checks the saved
  journal date, current journal date and current date. Current-period repayments
  remain possible after the original loan's start period closes. Reopening periods
  remains the existing owner-controlled workflow.
- Closing requires zero posted principal-account balance, zero unpaid managed
  interest accruals and no unresolved references. It is an
  administrative state, not a computed payment/accrual operation. Subsequent normal
  journals can change the balance of a closed entry; the balance remains visible.

## Additional Schedule Models

The native loan editor supports fixed principal (`fixed-principal-v2`) and EMI
(`emi-v1`), with either a fixed annual rate or explicitly dated floating-rate
resets. Rates are integer basis points; resets are unique, ordered, strictly after
the loan start and before maturity. There is no automatic benchmark-rate feed.

The optional `interestBasis` is one of:

- `monthly`: one twelfth of the annual rate per contractual period, including
  an irregular first period. A reset inside the period weights the old/new rates
  by their actual days within that period before applying the one-twelfth factor.
- `actual-365`: actual elapsed days divided by 365, including leap-year days.
- `actual-360`: actual elapsed days divided by 360.

Periods include their start date and exclude their due date. A rate effective on
a due date first affects the next period. Interest is calculated on the opening
planned principal, splitting at every effective-rate date, and rounded half-up
once per installment rather than daily. Principal does not change inside a
planned period. Actual repayments remain separate ledger movements.

Fixed-principal v2 retains equal whole-paise principal and a final remainder.
EMI uses exact integer amortization to find the smallest whole-paise installment
that clears the remaining term under the current rate and remaining date/basis
factors. Future announced resets do not change earlier installments. When a reset
becomes effective, the current period uses its blended rate and the remaining
EMI is recalculated using the newly effective rate, keeping maturity unchanged.
The last installment pays the exact remaining principal and rounded interest.
Terms requiring negative amortization or an early payoff caused by insufficient
whole-paise principal are rejected, not silently capitalized or shortened.

After history exists, only rate changes strictly after today and every referenced
or managed-interest installment's due date may be added, changed or removed.
Earlier rate rows, initial rate, principal, tenor, dates, model and basis are
immutable. Revisions require the displayed loan version and a reason, and retain
full before/after audit snapshots. A closed original start period does not block
a valid future-only rate revision. Scheduled projections still never post journals.

The six legacy term fields remain unchanged. New models use optional
`interestBasis` and optional `rateChanges: { effectiveDate, annualRateBps }[]`.
Parsers inject no defaults. Missing basis means monthly, and missing rate changes
means a fixed rate, without adding fields to a legacy backup payload.

## Managed Interest

The confirmed posting policy requires user review before every interest posting;
unattended interest posting is not a pending requirement.

`/settlements/interest` posts an explicitly reviewed actual amount for a due
contractual installment. It does not copy planned interest into the ledger or
calculate the actual charge from elapsed days. The statement/agreement reference,
reason, loan version and no-duplicate confirmation are required.

- Borrowed accrual: `expense:Interest Paid` Dr, a dedicated `Other Current
Liabilities` interest account Cr. Payment clears that account Dr against cash/bank Cr.
- Lent accrual: a dedicated `Other Current Assets` interest account Dr,
  `income:Interest Received` Cr. Recovery debits cash/bank and clears that account Cr.
- The principal account never receives these interest postings. Payment/recovery
  references a specific accrual, may be partial, cannot exceed its unpaid amount,
  and never records interest expense/income a second time.
- Only one unreversed managed accrual per installment is allowed. An existing
  posted repayment reference with directly expensed or reviewed settled interest blocks an accrual,
  even if its reference was removed. Conversely, an unreversed accrual blocks
  linking either kind of interest for that installment.
- Arbitrary manual journals cannot always be identified as the same interest.
  The explicit no-duplicate confirmation remains necessary; this is not automatic
  reconciliation of all historical finance entries.
- Owner/accountant posting uses the current loan version and advances that
  version. Owner reversal creates another journal and advances it again.
  Reverse payments before their accrual; reverse dates cannot precede dependent
  corrections. Reversed accruals may be replaced by a newly reviewed posting.
- Managed interest history is in the settlement register, linked from loan
  details. Register audit events still describe register/reference changes; the
  immutable settlement row and ordinary voucher audit record each interest posting.

## Reviewed Repayment Allocation

The native repayment-reference form offers an all-principal mode and a reviewed
split. Split amounts start blank: the user enters both positive principal and
nonnegative previously accrued interest settled, then confirms the statement-based
allocation. Changing the journal or amounts clears confirmation. The split must
account for the entire loan-account reduction in whole paise; no distribution is
inferred from the planned schedule or entered on the user's behalf.

The optional request is
`allocation: { principal, settledInterest, confirmed: true }`. The existing
`principalConfirmed: true` remains required. Without `allocation`, the request
retains its original all-principal meaning and parser shape. Unknown allocation
fields, missing confirmation, zero principal, negative/fractional amounts and
nonmatching totals are rejected. Pure-interest references remain outside this
positive-principal, whole-journal workflow.

The existing reference columns store reviewed principal and total referenced
interest, with these exact identities:

- `principal + settledInterest = accountReduction`.
- `interest = separatelyPostedInterest + settledInterest`.

Separately expensed interest is therefore preserved, never replaced or expensed
again. No journal, posting, cash movement or planned schedule is changed. The
register's referenced-interest total includes both reviewed settled interest and
separately expensed interest; it is not an additional expense or accrual.

For unchanged posted journals, reference details expose `sourceValues` containing
the account reduction, separately posted interest and settled-interest portion.
Changed/cancelled journals retain their saved principal/interest and review state
but do not expose a newly inferred breakdown. New link audit snapshots retain the
original source amounts and explicit allocation/confirmation. A correction removes
the old reference with a reason and links a newly reviewed allocation; it never
rewrites the old amounts or audit history.

The existing owner/accountant role, firm lock, journal/loan versions, idempotency,
same-firm ownership and closed-period rules apply. Historical closed dates require
the existing period-reopening workflow before a new link or correction. This
extension uses the existing columns and audit JSON, with no DDL or backup-version
change. Legacy references retain their original amounts and zero settled-interest
interpretation when checked against their unchanged source journal.

## Settlement Workflows

All actions create balanced journals through the existing financial engine,
including its numbering, postings, audit and date/closed-period checks. They do
not introduce a second accounting engine or change the original financial entry.

| Action               | Debit                 | Credit                |
| -------------------- | --------------------- | --------------------- |
| Customer advance     | Cash/bank             | Customer              |
| Supplier advance     | Supplier              | Cash/bank             |
| Customer refund      | Customer              | Cash/bank             |
| Supplier refund      | Cash/bank             | Supplier              |
| Receivable write-off | Bad Debts Written Off | Customer              |
| Payable write-back   | Supplier              | Payables Written Back |

These postings have no GST tax legs or statutory credit-note implications. Refunds
are limited to the party's actual credit balance in the selected book, both at
the entry date and today. Write-offs need explicit bill amounts and owner approval;
they cannot exceed pending bills or the party's net outstanding balance.

Allocation correction records a same-party Dr/Cr journal with zero economic
effect plus signed bill-allocation deltas. Positive deltas settle a bill;
negative deltas release an earlier allocation. The journal's face amount is the
larger of old/new allocations, not a cash movement. Original receipts, payments,
advance journals and their saved allocations remain unchanged. Each correction
requires the original voucher version and the latest correction revision.

Corrections are prospective, cannot precede their source/latest correction, and
cannot allocate funds already refunded or used elsewhere. All targets and the
source must belong to the same party and GST/non-GST book. This workflow excludes
TDS-bearing sources and split opening balances. Imported individual opening bills
use immutable `opening-bill:<id>` references; they must belong wholly to the
selected book for this workflow. Existing receipt/payment allocation handles
opening bills split between books.

Owner reversals append opposite postings and opposite signed allocations. An
advance must first have its allocations released and its funds available; active
dependent payments block reversal. Reversal-of-reversal is disallowed. A new
reviewed allocation correction with the current source version and correction
revision restores prior bill links; the reversal endpoint rejects allocation
corrections. Managed entries, original correction sources and affected bills are
protected against ordinary financial edits/cancellation. Bank-clearing metadata
does not rewrite their economic history.

Owners/accountants can post advances, refunds, corrections and managed interest.
Only owners may write off, reverse or approve excess credit. Viewers read;
sales roles cannot access settlement records. Writes recheck current membership
under the firm lock before idempotency replay. They require a durable request key,
an explicit book, a reason and the relevant reviewed versions.

Read projections keep original `allocations` separate from signed
`settlementAllocations`. `billAllocations` combines them for bill totals.
`settlementUnallocatedAdjustment` adds advances, subtracts refunds and applies
correction/reversal movements to ordinary unallocated receipts/payments. It
deliberately excludes write-offs, which are not cash. `unallocatedMoney` combines
the adjustment with ordinary unallocated receipts/payments and clamps only the
combined total at zero. Core and voucher contracts preserve
`settlementSourceVoucherId`, allowing reversals to retain their source kind after
API parsing. Scope filtering selects the settlement journal's book; signed deltas
are not repartitioned across books a second time.

## Credit Authorization

The limit check uses the actual post-save, all-books customer balance inside the
sale transaction, including split sales. An owner can issue a 15-minute approval
for one exact request. It records the customer version, credit limit, projected
balance, immutable request hash, actor and reason. Consumption rechecks current
posting permissions, approving-owner membership, customer version, expiry,
request identity and exposure, then appends one use per resulting sale. The
firm lock prevents concurrent reuse. Ordinary under-limit sales need no approval.

For invoice edits, approval requires `editVoucherId` and `editVersion`; its dry
run replaces the reviewed sale rather than adding another sale. The hash binds
both values. Repeated edits require distinct approvals, and a customer cannot
change on an already credit-authorized sale. Frozen order approval rebuilds the
fulfillment plan from the source/version and selected quantities, including stock
lots and GST/non-GST batches. It does not authorize a freely edited invoice.

Native invoice and frozen-order forms use these approval operations, including
the reviewed invoice/version for edits. Shared sale and order posting hooks
enforce them inside the transaction. Merely obtaining an approval never posts a
sale or changes a customer limit.

## Application Integration

- Loan contracts, the core schedule calculator and database tables are exported
  through their existing package/schema barrels. `0014_loan_register` is registered
  in the migration journal. Its ownership and append-only triggers are part of the
  migration; the audit trigger depends on `audit_log_is_append_only()`.
- `apps/api/src/app.ts` registers `loanRoutes` under `/v1` with the existing
  authentication, firm scoping and cache infrastructure.
- Native `Services` exposes optional `loanService`, and `remoteServices` supplies
  the real REST implementation. Demo mode has no loan persistence; an absent
  service displays connection state. `loanHooks.ts` uses the existing scoped
  queries, role/member cache keys and invalidation. Mutations use POST through
  the existing pending-write transport to retain durable retry behavior.
- Settings includes a report-permission-gated Loan register entry. Routes are
  `/loans` (list), `/loans/new` (register), `/loans/new?id=<id>` (edit),
  `/loans/<id>` (details) and `/loans/<id>/reference` (link repayment).
  Screen and API guards restrict writes to owners/accountants, including direct
  navigation. Existing `/journal/financing` and account/voucher details are linked.
- Loan reads have no tax filter: they show the whole linked account using the
  existing report reader. `openingGstBalance` / `openingGstAmount` allocations
  divide GST and non-GST reporting without changing this all-books total.

Requests (all paths relative to `/v1`):

| Method | Path                                        | Body / Response                          |
| ------ | ------------------------------------------- | ---------------------------------------- |
| GET    | `/loans`                                    | `LoanPage`, limit/cursor                 |
| GET    | `/loans/:id`                                | `LoanDetail`                             |
| GET    | `/loans/:id/history`                        | `LoanHistoryPage`, limit/cursor          |
| GET    | `/loans/:id/repayment-journals`             | `LoanCandidatePage`, limit/cursor        |
| POST   | `/loans`                                    | `LoanInput` -> 201 `LoanRecord`          |
| POST   | `/loans/:id/update`                         | `LoanUpdate` -> `LoanRecord`             |
| POST   | `/loans/:id/references`                     | `LoanReferenceInput` -> 201 `LoanRecord` |
| POST   | `/loans/:id/references/:referenceId/remove` | `{ reason }` -> `LoanRecord`             |

Mutation replies intentionally contain only the register/version, not cached
ledger balances or reference validity. Clients refetch details after success.

Settlement routes are registered under `/v1`, with the connected native service
and standalone `/settlements`, `/settlements/new`, `/settlements/:id` and
`/settlements/interest` pages. Loan details link interest history and posting.
There is no demo persistence stub. New financial saves retain the existing
pending-write transport's exact body and retry key after an uncertain response.

| Method | Path                                  | Request                                                 |
| ------ | ------------------------------------- | ------------------------------------------------------- |
| GET    | `/settlements`                        | limit/cursor, optional partyId/loanId                   |
| GET    | `/settlements/context`                | partyId, date, bookScope                                |
| GET    | `/settlements/:id`                    | immutable record                                        |
| POST   | `/settlements`                        | `SettlementInput`                                       |
| POST   | `/settlements/:id/reverse`            | date, bookScope, reason, version                        |
| POST   | `/settlements/loan-interest`          | `LoanInterestInput`                                     |
| POST   | `/settlements/credit-approvals`       | sale, reason, optional paired editVoucherId/editVersion |
| POST   | `/settlements/order-credit-approvals` | sourceId, fulfillment, reason                           |

Sale posting invokes `enforceSaleCredit` after all sale rows are saved but before
committing, passing edit context for amendments. Frozen order posting uses
`enforcePlannedSaleCredit` with the exact server-built plan. Generic bulk payment
allocation skips settlement-locked sources, preserving their original allocations
for the audited correction workflow. These checks are enforced in shared
accounting and transaction code, not only by client-side validation.

## Backup and Restore

Current v4 financial exports include all three loan tables, including
`principalConfirmed`, removed references and immutable audit events. Loan data
was introduced in v3, which remains readable. Unsupported payload versions are rejected
rather than silently stripping loan data. Restore creates a new firm in one
transaction and preserves register terms and reference history as well as journals.

| Table                       | Fields to preserve                                                                                                                                | ID mapping                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `loans`                     | name, counterparty, agreementReference, note, direction, terms (including scheduleModel), maturityDate, status, version, createdAt, updatedAt     | new id, new firmId, remap accountId                                                                    |
| `loan_repayment_references` | voucherVersion, voucherNumber, voucherDate, installmentNumber, principalConfirmed (must be true), principal, interest, note, createdAt, removedAt | new id, firmId, loanId and voucherId                                                                   |
| `loan_events`               | action, reason, at, before, after                                                                                                                 | new id, firmId and loanId; remap userId to a historical actor ID and prefix userName with `[Imported]` |

Accounts are inserted before loans; loans and vouchers are inserted before
references/events. Validation checks firm ownership, account groups, unique
dedicated accounts, unique live voucher references, installment ranges, the
schedule model and recomputed maturity. Unchanged posted references must match
their journal's number/date and total repayment, with positive reviewed principal
no greater than the account reduction and referenced interest no less than the
separately expensed amount. `repaymentReferenceMatches` validates these identities
with integer arithmetic for both live reads and restore checks. Loan and voucher versions,
removed timestamps and journal status are preserved, so changed/cancelled or
removed references do not become valid merely because they were restored.

Live record columns and relationships use new record IDs. Historical actor IDs
are remapped consistently across loan events and other imported history; imported
names receive a single `[Imported]` prefix. These actor IDs do not create login
accounts or grant membership. The restoring user receives the new firm's owner
membership separately.

Audit snapshots are structured JSON with these exact shapes:

- `created`: before `{}`, after full camelCase `LoanRecord`.
- `updated`: before/after full camelCase `LoanRecord`.
- `reference-added`: before `{ version }`, after `{ version, reference }`;
  new links also include `sourceValues: { accountReduction, separatelyPostedInterest }`
  and, for reviewed splits, `allocation: { principal, settledInterest, confirmed: true }`.
- `reference-removed`: before/after `{ version, reference }`.
- `reference` is the Drizzle row: id, firmId, loanId, voucherId, voucherVersion,
  voucherNumber, voucherDate, installmentNumber, principalConfirmed, principal, interest, note,
  createdAt, removedAt. Dates serialize to ISO timestamps in JSONB.

Audit `before` and `after` JSON is intentionally preserved verbatim, including
any original record IDs embedded in those snapshots. These are historical values,
not live links; they are not rewritten to point at restored records. This is the
same policy used for all imported backup history. The immutable restore-origin
event records source provenance and the record/actor ID maps; it does not contain
a copy of the entire backup file or assign imported history to the restoring user.

Loan tables contain no attachment binaries or R2 keys. Loans use the authenticated
online REST service and existing request retries, with no loan-specific offline
editing or sync entities.

Settlement exports require backup v4 and migration `0018_settlement_controls`.
The legacy six-field `LoanTerms` shape adds no defaults when reading v3. v4 also
preserves optional interest basis, dated rate resets and the new model literals.
v3 files naturally contain no new settlement history.

| Table                    | Preserved values                                                                      | Live references remapped on restore                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `settlement_entries`     | kind, installmentNumber, date, bookScope, amount, reason, version, createdAt, details | id, firmId, voucherId, partyId, sourceVoucherId, sourceEntryId, loanId, interestAccountId, historical userId/name |
| `settlement_allocations` | signed nonzero amount                                                                 | id, firmId, entryId, voucherId, exactly one of billId, openingPartyId or openingBillId                            |
| `credit_approvals`       | partyVersion, saleHash, creditLimit, projectedBalance, reason, createdAt, expiresAt   | id, firmId, partyId, historical userId/name                                                                       |
| `credit_approval_uses`   | createdAt                                                                             | id, firmId, approvalId, voucherId, historical userId                                                              |

Entries precede their dependent payments/reversals; allocations follow entries
and their target records. Approval uses follow approvals and vouchers. Entry
journals are unique, a source has at most one reversal, and approval uses are
unique by `(approvalId, voucherId)`, allowing distinct approved edits of one sale.
The four tables reject updates/deletes/truncation and validate same-firm links.
Historical `details` and all audit before/after JSON remain verbatim snapshots,
not rewritten live links. Imported actors have no membership, so restored
approval records do not grant new spending authority. Review restored references
and balances before business use; follow the separate independent recovery guide
for an operational restore.

## Research Basis

The equal-principal/decreasing-balance model is explicitly described in the
[CFPB payment schedule discussion, section 1026.18(g)](https://www.consumerfinance.gov/rules-policy/regulations/1026/2023-05-15/18/).
That historical primary source informed the mathematical model, not an assertion
of Indian regulatory compliance. The [CFPB amortization explanation](https://www.consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/)
also distinguishes principal from interest. The product's equal-month basis,
rounding, final remainder and date anchoring are explicit engineering decisions;
use only when they match the actual agreement. No APR/KFS or statutory disclosure
compliance is claimed.

The [RBI's April 2024 charging-of-interest circular](https://www.rbi.org.in/scripts/bs_circularindexdisplay.aspx/BS_CircularIndexDisplay.aspx?Id=12678)
highlights the difference between actual disbursement/outstanding periods and
whole-month assumptions. The product decision is therefore to keep contractual
monthly projections unposted and require a reviewed actual interest amount.
The [IASB April 2024 staff discussion, paragraphs 52-53](https://www.ifrs.org/content/dam/ifrs/meetings/2024/april/iasb/ap27c-feedback-analysis-application-ifrs9-impairment-requirements.pdf)
discusses the judgment involved in write-offs. It informs explicit owner review;
this simple workflow does not implement IFRS 9 impairment/ECL or certify tax treatment.
The [RBI August 2023 floating-rate EMI guidance](https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12529)
addresses communicated resets and negative amortization. The implemented model
uses explicit audited rate dates, constant tenor and positive principal repayment;
it does not implement a lender's full regulated disclosure or borrower-option framework.

## Manual Checks and Boundaries

On staging, review a saved repayment schedule, confirm an interest posting and
record an explicit principal/interest allocation. Compare loan balances and
journal amounts before and after restart. Check that retries retain the same
result and that closed-period or unauthorized changes are rejected.

For recovered books, review saved terms, historical references and all three book
scopes before business use. Device behavior and recovery remain operational checks.

- Scope boundaries: arbitrary retrospective contract amendments, automatic external
  benchmark feeds, holiday shifts, fees/penalties, Actual/Actual or 30/360 bases,
  automated payments, partial-journal references, repayment forecasts, reminders,
  loan attachments or offline
  outbox/sync remain outside this slice. Settlement TDS corrections, split aggregate
  opening corrections, automatic impairment assessment and tax adjustments are
  also outside its scope.
  Existing finance journals remain the accounting entry mechanism.

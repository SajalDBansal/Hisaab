# 09. Business Associates and Commissions

[Documentation index](README.md)

Associates are integrated with profiles, invoice/order hooks, delivery print
data, commission journals and financial exports. Commission becomes payable when a sale is
posted, on discounted item value excluding GST and freight. Returns reduce it.

## One profile, explicit roles

Use one firm-owned **Business Associate** profile, not a separate person record
for every function. An associate can have delivery, referral and commission-agent
roles together. Keep customer/supplier trading accounts separate, with optional
links to the same associate. Do not create an application login for an associate
unless the owner separately invites that person to the team.

An equity partner is different from a commission agent. Ownership, capital,
drawings and profit distribution belong to capital accounts. Receiving a sales
commission must never imply ownership or a right to edit the books.

This is a design recommendation, not a claim that every accounting package uses
this schema. Zoho associates salespeople with invoices and retains references
when profiles have transactions. Tally uses agent cost-centre allocations to
analyse commission-related sales. These are useful precedents for explicit
transaction links rather than free-text partner names.
[Zoho invoice associates](https://www.zoho.com/ke/books/kb/invoices/asocciate-sales-person.html)
and [Tally agent tracking](https://help.tallysolutions.com/salesperson-details-collection-commission-tally/).

## Profile fields

Common fields: name, phone, optional email/address, notes, active status, roles,
and optional links to customer/supplier accounts. Archive used profiles rather
than deleting them. Names and contact details are not unique identifiers.

Delivery role: vehicle/registration, delivery area, contact preference and whether
the contact number may appear on a customer-facing printout.

Commission role: payable account, default percentage, effective date, eligible
items/groups, and whether an accountant may override the rule. The supported
calculation is a percentage of discounted net item value only. Fixed
amounts, slab rates and margin-based incentives need separate tested policies.

Custom fields can hold descriptive text, decimal numbers, dates, checkboxes and
fixed choices. Definitions and validation belong to the firm. They must not
contain executable formulas, select ledger accounts implicitly, or change tax,
commission or posting behavior. Standard role fields control those functions.

## Delivery workflow

1. Create or select a delivery associate in the sale/challan form.
2. Save the associate ID and an immutable snapshot of the printable name, vehicle,
   phone visibility and delivery reference with the issued document.
3. Print the delivery details on both invoices when a mixed sale creates GST and
   non-GST bills. Never print private commission rates or balances there.
4. Show linked bills on the associate profile with assigned, dispatched,
   delivered, failed and returned statuses, dates and filters.
5. Allow proof-of-delivery photos through the private attachment pipeline.

Delivery status does not automatically settle a customer bill or earn another
commission. Record delivery charges paid to a carrier separately from freight
charged to a customer. If multiple deliveries per bill are needed, use an
assignment table; do not keep replacing a single historical name.

## Commission calculation

- Each eligible invoice line stores its selected associate, rule version, original
  discounted net value, rate and earned amount in integer paise.
- Calculate against the posted sale's authoritative values. Exclude GST, freight,
  round-off and noneligible lines. Do not use the receipt amount or the current
  item selling price.
- Round each line once when posting. Save that result. Partial-return reversals
  allocate from the original saved commission; the last return receives the
  remaining paise so a full return reverses exactly the original amount.
- GST and non-GST split invoices earn commission only on their own lines. The
  original cart must not also generate a third aggregate accrual.
- Later rule/profile changes affect new sales only. Editing a sale reverses and
  replaces its commission atomically using a defined, displayed rule snapshot.
- Cancelling a sale reverses its entire accrual. A cancellation or return after
  payout creates a recovery balance or reduces future payables; it must not disappear.

Example: item value INR 10,000 minus INR 1,000 discount gives INR 9,000 eligible
value. At 2%, commission is INR 180. A return with INR 2,000 of original eligible
value reverses INR 40. Net earned commission is INR 140, independent of GST and
delivery charges.

## Accounting entries

On posted sale:

| Debit              | Credit                         |
| ------------------ | ------------------------------ |
| Commission Expense | Commission Payable - Associate |

On payout:

| Debit                          | Credit      |
| ------------------------------ | ----------- |
| Commission Payable - Associate | Cash / Bank |

On reversal: reverse the original commission accrual, not the customer's sales
value a second time. Customer credit notes already handle the sales return.
Payout must not debit Commission Expense again. Keep payout allocations against
earned entries to explain opening due, earned, reversed, paid and closing due.

Zoho documents commission as an expense account. The separate payable and payout
allocation above are our accrual-based design for the policy selected here.
[Zoho commission expenses](https://www.zoho.com/in/books/kb/accountant/record-commissions-paid-to-salesperson.html).

Commission expense/payable inherit the sale's book category. Payouts spanning
both categories need separate, linked allocations/postings that reconcile to one
bank movement in mixed reports. Never move a commission between categories just
because the payout happens later. Tax withholding, when applicable to a business,
needs an explicit accountant-approved entry; this design does not automate tax
filing or determine statutory obligations.

## Implementation boundaries

### Implemented integration

`packages/contracts/src/associates.ts` defines the public request/response schemas.
The API route plugin is `associateRoutes` in
`apps/api/src/modules/associates/associates.routes.ts`. Native wiring adds
`associateService: associateServices(client)` to remote services, the optional
`AssociateService` to the services type, and navigation to `/associates` for
owners/accountants. Sales selectors use the separate sanitized options endpoint.
The register, profile editor, field editor, deliveries, sales, statement, exports,
payout and reversal forms live under `apps/native/app/associates`.

Shared invoice/order input fields are:

```ts
delivery?: { associateId: string; reference: string } | null;
commission?: { associateId: string; rate?: number } | null;
```

Omitted fields retain prior snapshots when editing or converting a source order;
`null` removes the selection. The server resolves selections, never trusts a
client-provided rule or print snapshot. An explicit reselection adopts the current
profile/rule. An inherited order selection retains its approved snapshot but must
still name an active associate with the required role.

`Voucher.delivery` uses `DeliverySnapshot`: `associateId`, `reference`, `name`,
`vehicle`, optional public `phone`, `printPhone`, and `profileVersion`.
`Voucher.commission` uses `CommissionSnapshot`: `associateId`, `name`,
`ruleVersion`, `payableAccountId`, percentage `rate`, `effectiveFrom`, `itemIds`
and `groups`. Only the delivery snapshot belongs in `VoucherSnapshot` and
customer-facing print data. The isolated `associateDeliveryHtml` helper escapes
these public fields and respects saved phone visibility.

Inside the existing firm transaction and advisory lock:

1. Await `prepareInvoiceAssociates(tx, ctx, input, input.date, previousVoucher)`
   before core create/edit/conversion. Apply the returned `delivery` and
   `commission` to each resulting sale or order, and `delivery` to issued print
   snapshots. The `InvoiceAssociates` native component edits the selection DTO.
2. Keep the existing period, stock, permissions and edit/cancel blockers.
3. After `saveChanges`, await `syncAssociateVouchers(tx, ctx, snap, saved)` before
   `rememberAnswer`. `saved.versions` is indexed using the original core ID;
   `saved.idOf` maps each source ID before inserts. Mixed invoice outputs each
   accrue only their own lines. Orders and challans do not accrue commission.
4. Call `assertAssociateJournalEditable` before direct voucher edit/cancel of a
   generated journal. `associate_journals` identifies system-managed entries.
   Bank reconciliation may still record bank dates through the normal workflow.
5. Firm REST serialization and sync apply `associatePayloadForRead(role, payload)`
   to nested voucher responses, including conflict and historical replay answers.
   Non-owner/accountant reads omit private commission snapshots. Viewer access to
   journals, balances and reports is unchanged. Native scoped queries, mutations,
   and persisted offline reads/operation answers apply the same filter; role
   changes evict the previous React Query scope without discarding pending writes.

Order fulfillment checks inherited associate eligibility in the same write
transaction before core creation. Frozen names, rates, eligible items and rule
versions are copied, not refreshed from the live profile.

Generated commission journals use `loadBooks -> createJournal -> saveChanges`
inside the same firm transaction, followed by the immutable journal link. This
keeps configured number series, counters, issued snapshots, postings and audit
identical to the established journal path. It does not call `change()` again.

Migration `0020_business_associates.sql` owns the `vouchers.delivery` and
`vouchers.commission` JSON columns as well as all associate tables. The shared
Drizzle voucher schema, schema barrel and persistence/hydration include these
fields and tables. The migration is registered in the shared migration sequence.

Tables exported by `db/schema/associates.ts`: `associates`, `associateFields`,
`associateRules`, `deliveryAssignments`, `commissionAccruals`, `associatePayouts`,
`commissionPayoutAllocations`, `associateJournals`, `commissionEntries`, and
`associateEvents`. Roles and descriptive field values are validated JSON on the
profile; definitions are firm-owned rows. Rule snapshots, movement entries,
payout allocations, journal links and audit events are append-only. Accruals can
only retire their active flag, and delivery status changes cannot rewrite the
issued delivery snapshot. Backup v4 includes these tables and remaps every
firm/associate/account/item/party/voucher/payout/accrual ID (including JSON rule and
delivery snapshots and descriptive field IDs), retaining historical rows. Replay
event keys remap their embedded source IDs consistently with restored rows.
Audit writes and restore preserve JSON `null` in required JSON columns rather
than inserting SQL `NULL`; nullable columns retain their SQL-null behavior.

The payable account must be a dedicated unused zero-opening account in Other
Current Liabilities or Provisions. Once selected on any saved document (including
an unfulfilled order), its identity and commission role cannot be removed; archive
the associate instead. Rule changes apply to new
selections only. Percentage eligibility is all items when both eligibility lists
are empty, otherwise the union of selected item IDs and group names.

Payouts allocate positive paise to unpaid accruals. The service checks each
allocation, each book category and the overall net balance both on the payout
date and now. It rejects overpayment and uncorrected ledger differences. A mixed
payout creates one payout record with two linked journal partitions whose cash
credits sum to the recorded movement. A current-period payout reversal appends
opposite entries and never cancels or rewrites a closed original journal.

Returns round the cumulative returned quantity against the saved earned paise;
cancelled returns restore that saved share. Editing a sale retires its previous
accrual and posts its replacement, leaving any prior payout allocations visible.
A post-payout return or cancellation can leave a negative recoverable balance.
Statements show opening, earnings, signed adjustments, net payouts, closing,
payable ledger and reconciliation difference, with GST/non-GST/mixed filters.
Delivery proof uses the existing private attachments on the source voucher.

Commission source documents use separate foreign keys from the existing
`sourceId` order-conversion relationship. Generated journals have system-managed
links: users correct them through the originating sale/return, not by
independently editing one side of the relationship.

Firm ownership, role permissions, optimistic versions, idempotency and the
existing firm transaction lock guard writes. Posting a sale, its stock movement
and its commission succeeds or rolls back together. Period locks also apply to
commission adjustments. A current-period return leaves the closed sale unchanged.

## Manual Checks

- Cross-firm associate/ledger IDs and archived profiles cannot be attached to new bills.
- A person with both roles is stored once; commission details remain private on prints.
- Retry and concurrent saves create one accrual per source/rule/associate.
- Discounts, tax-inclusive prices, fractional quantities and mixed splits use the same net basis.
- Several partial returns add up to the exact original commission, including rounding pennies.
- Cancel, edit, return-after-payout, payout reversal and overpayment have explicit outcomes.
- Changing an associate's name or rule never changes an old invoice or accrual.
- Commission statement totals reconcile to payable/expense ledgers in each book scope.
- Closing, reopening, offline replay and restart preserve both accounting and audit history.

## Adjacent accounting priorities

Margin-based incentives require separate validation of physical stock adjustments
and landed-cost allocation. Purchase transport/handling and nonrecoverable taxes
can belong in inventory acquisition cost; sales commissions are a different
business cost. The exact reporting policy should be reviewed with the business's
accountant. [IAS 2 inventory cost overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/).

Profile flexibility must not bypass settlement, loan, backup, import or offline
conflict controls.

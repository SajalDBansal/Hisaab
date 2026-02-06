# 11. Partial Order Fulfillment

[Documentation index](README.md)

## Workflow

Open a source order's fulfillment action, select the quantities and stock lots,
review the resulting documents, then confirm. Partial fulfillment leaves the
remaining quantities on the source. Mixed-book batches save together, and
delivery-note billing does not consume the same stock twice.

The screen is `/order/fulfill?id=<voucherId>`. Its API reads
`GET /v1/orders/:id/fulfillment` and posts to `POST /v1/orders/:id/fulfill`.
These are existing routes, not integration work still to be added.

## Code Integration

- `app.ts` registers `orderFulfillmentRoutes` with the `orderFulfillmentHooks`
  adapter. The asynchronous `create(tx, actor, plan)` hook uses the existing
  `change()` path and supplied transaction, including associate eligibility
  checks. It returns persisted vouchers with their final IDs.
- Each batch carries frozen lines, charges, source snapshot, tax mode and
  interstate status. `orderSourceLineId` and `stockFulfilledById` preserve source
  and stock provenance; ordinary client invoice bodies cannot supply them.
- Shared voucher hydration calls `hydrateOrderFulfillment` to load dedicated
  line/fulfillment tables. Managed delivery notes move stock; billed sales do
  not move it again. Sales returns restore the original delivery lot/cost.
- Voucher edits/cancellations call `assertOrderChangeAllowed` under the firm
  lock. After-save processing calls `afterOrderVoucherChange` to update capacity
  and versions. A return cannot be cancelled after its released quantity is reused.
- Managed conversions use this module, not the legacy single `convertedToId`
  relationship. Frozen master, delivery and commission snapshots are retained;
  the associate after-save hook records eligible sale commission.
- Native `remoteServices` supplies `orderFulfillmentService`. Migration
  `0019_order_fulfillment.sql` and backup/restore mappings include the dedicated
  tables, source/target/line IDs, stock provenance and stored receipt identities.

Keep new behavior inside the same transaction and existing financial engine;
do not introduce a second numbering, stock or posting path.

## Quantity rules

Quantities are in the saved source unit, with three decimal places. Duplicate
item rows remain distinct. Every request checks the source version under the
same firm advisory lock as normal posting. Both book batches and their numbers
are committed together, or all are rolled back. Retry receipts are durable and
scoped to firm, actor and key, including the exact request hash.
Capacity is checked at each affected business date; a later return cannot fund a
backdated fulfillment before that return occurred.

Cancelled children release their quantity. Sales/purchase returns release the
quantity on the directly originating order. A return against a delivery-based
sale reopens the originating sales order, but does not make already returned
goods invoiceable again on the delivery note. An estimate converted to a sales
order remains consumed by that order until that order is cancelled.

Consumed source documents and generated child documents cannot be edited.
Cancel descendants first to cancel a source. Returns and their cancellation
must pass the capacity guard in the same transaction. Historical links remain.
The financial path checks the new return's date. A historical source-order date
does not block quantity/status-only updates from a current-period return.
Conversion itself still checks the source and target dates against closed books.

Rates, discount basis, packing factors, tax treatment and master snapshots come
from the issued source. Fixed discounts use cumulative whole-paise allocation.
Charges are allocated proportionally across conversions with cumulative rounding;
returns do not automatically refund freight or grant it again on replacements.

Sale fulfillment calls the shared `enforcePlannedSaleCredit` validator after
all batches are saved, before the same transaction commits. Optional
`creditOverrideId` must authorize the exact frozen plan and combined customer
exposure. A rejection rolls back counters, financial entries and fulfillment
metadata. The owner can approve and retry from the fulfillment screen; existing
durable replay does not spend the approval twice.

## Restore validation

`backup/restore.checks.ts` hydrates persisted order-line identities, delivery
stock provenance, settlement kinds and signed allocations before financial and
stock replay. It validates source snapshots, receipt targets, historical order
capacity, adjustment journals/reversals, split opening lots, opening-bill
reconciliation and correction funding sources. Imported opening bills use
`opening-bill:<id>` independently of legacy synthetic `opening:<partyId>` rows.
Cancelled children and ordinary journals retain their historical metadata while
their live effects are excluded. Restore validation must preserve complete ID
remapping and ensure delivery invoices do not move stock again.
Quantity-only inventory corrections/reversals may have zero amount and empty
financial lines only with a posted inventory marker and nonzero quantity.
Ordinary empty journals remain invalid. Adjustment replay follows write order,
then stock replay independently checks the full business-date history.

## Limits and Manual Checks

Legacy conversions without line provenance are unavailable for partial conversion.
Each source line uses one lot per request; use successive partial requests to
fulfill it from different lots. Price/quantity changes require a replacement order.

Voucher headers and durable fulfillment receipts remap nested opening-bill and
opening-lot identities during restore. Lot identities are mapped before item
identities. `settlementSourceVoucherId` is retained in the shared Voucher contract,
restore hydration and receipt remapping.

On staging, partially fulfill an order, reload it and check remaining quantities.
For mixed books, confirm both saved documents and stock effects. Review retries,
returns, role changes and period locks without changing the closed source order.
Check the resulting screens and printouts on intended devices.

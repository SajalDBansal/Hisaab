import type { FirmExportData, Voucher, InvoiceLine } from "@repo/contracts";
import type {
  CommissionSnapshot,
  DeliverySnapshot,
} from "@repo/contracts/src/associates";
import type { restoreIds } from "./restore.remap";
import { unsupported } from "./restore.remap";

type Ids = ReturnType<typeof restoreIds>;

function commission(value: CommissionSnapshot | null | undefined, ids: Ids) {
  if (!value) return;
  value.associateId = ids.id(value.associateId);
  value.payableAccountId = ids.id(value.payableAccountId);
  value.itemIds = value.itemIds.map(ids.id);
}
function delivery(value: DeliverySnapshot | null | undefined, ids: Ids) {
  if (value) value.associateId = ids.id(value.associateId);
}
function line(value: InvoiceLine, ids: Ids) {
  if (value.stockLotId)
    value.stockLotId = ids.lot(value.stockLotId, value.itemId);
  value.itemId = ids.id(value.itemId);
  if (value.orderLineId) value.orderLineId = ids.id(value.orderLineId);
  if (value.orderSourceLineId)
    value.orderSourceLineId = ids.id(value.orderSourceLineId);
  if (value.stockFulfilledById)
    value.stockFulfilledById = ids.id(value.stockFulfilledById);
}
function allocation(value: string, ids: Ids) {
  if (value.startsWith("opening-bill:"))
    return `opening-bill:${ids.id(value.slice(13))}`;
  if (value.startsWith("opening:")) return `opening:${ids.id(value.slice(8))}`;
  return ids.id(value);
}

/** Issued values stay frozen; only identities change to the new firm's records. */
export function remapIssuedSnapshot(
  value: NonNullable<Voucher["snapshot"]>,
  ids: Ids,
) {
  value.firm.id = ids.id(value.firm.id);
  if (value.party) {
    value.party.id = ids.id(value.party.id);
    for (const bill of value.party.openingBills ?? []) {
      bill.id = ids.id(bill.id);
      bill.partyId = ids.id(bill.partyId);
    }
  }
  for (const item of value.items) {
    for (const lot of item.openingLots ?? []) lot.id = ids.lot(lot.id, item.id);
    item.id = ids.id(item.id);
  }
  if (value.settings.bankLedgerId)
    value.settings.bankLedgerId = ids.id(value.settings.bankLedgerId);
}

// Permanent order receipts contain API vouchers, not the normalized database header shape.
function receiptVoucher(value: Voucher, ids: Ids) {
  value.id = ids.id(value.id);
  for (const key of [
    "partyId",
    "ledgerId",
    "toLedgerId",
    "againstId",
    "sourceId",
    "convertedToId",
    "settlementSourceVoucherId",
  ] as const)
    if (value[key]) value[key] = ids.id(value[key]);
  for (const row of value.lines ?? []) line(row, ids);
  for (const row of value.journalLines ?? [])
    row.account = ids.account(row.account);
  for (const row of [
    ...(value.allocations ?? []),
    ...(value.settlementAllocations ?? []),
  ])
    row.voucherId = allocation(row.voucherId, ids);
  if (value.bankClearings)
    value.bankClearings = Object.fromEntries(
      Object.entries(value.bankClearings).map(([id, date]) => [
        ids.id(id),
        date,
      ]),
    );
  if (value.snapshot) remapIssuedSnapshot(value.snapshot, ids);
  commission(value.commission, ids);
  delivery(value.delivery, ids);
}

export function remapExtendedBooks(
  data: FirmExportData,
  source: FirmExportData,
  ids: Ids,
) {
  for (const [index, item] of data.items.entries()) {
    const original =
      source.items[index] ?? unsupported("An opening stock item is missing.");
    for (const lot of item.openingLots ?? [])
      lot.id = ids.lot(lot.id, original.id);
  }
  for (const voucher of data.vouchers) {
    commission(voucher.commission, ids);
    delivery(voucher.delivery, ids);
    const movement = voucher.inventoryAdjustment;
    if (movement) {
      movement.lotId = ids.lot(movement.lotId, movement.itemId);
      movement.itemId = ids.id(movement.itemId);
      if (movement.reversesId)
        movement.reversesId = ids.id(movement.reversesId);
    }
  }
  for (const row of data.importedOpeningBalances) {
    row.batchId = ids.id(row.batchId);
    row.targetId = ids.id(row.targetId);
  }
  for (const row of data.openingBills) {
    row.batchId = ids.id(row.batchId);
    row.partyId = ids.id(row.partyId);
  }
  for (const row of data.settlementEntries) {
    row.voucherId = ids.id(row.voucherId);
    for (const key of [
      "partyId",
      "sourceVoucherId",
      "sourceEntryId",
      "loanId",
      "interestAccountId",
    ] as const)
      row[key] = ids.optional(row[key]);
    row.userId = ids.actor(row.userId);
    row.userName = `[Imported] ${row.userName}`;
  }
  for (const row of data.settlementAllocations) {
    row.entryId = ids.id(row.entryId);
    row.voucherId = ids.id(row.voucherId);
    row.billId = ids.optional(row.billId);
    row.openingPartyId = ids.optional(row.openingPartyId);
    row.openingBillId = ids.optional(row.openingBillId);
  }
  for (const row of data.creditApprovals) {
    row.partyId = ids.id(row.partyId);
    row.userId = ids.actor(row.userId);
    row.userName = `[Imported] ${row.userName}`;
    // Historical approvals must never authorize a new transaction in restored books.
    row.expiresAt = row.createdAt;
  }
  for (const row of data.creditApprovalUses) {
    row.approvalId = ids.id(row.approvalId);
    row.voucherId = ids.id(row.voucherId);
    row.userId = ids.actor(row.userId);
  }
  for (const row of data.orderSourceLines) {
    row.sourceId = ids.id(row.sourceId);
    line(row.line, ids);
  }
  for (const row of data.orderFulfillments) {
    row.sourceId = ids.id(row.sourceId);
    row.userId = ids.actor(row.userId);
    row.userName = `[Imported] ${row.userName}`;
    row.response.id = ids.id(row.response.id);
    row.response.sourceId = ids.id(row.response.sourceId);
    for (const voucher of row.response.vouchers) receiptVoucher(voucher, ids);
  }
  for (const row of data.orderFulfillmentLines) {
    row.fulfillmentId = ids.id(row.fulfillmentId);
    row.sourceLineId = ids.id(row.sourceLineId);
    row.targetId = ids.id(row.targetId);
    row.stockFulfilledById = ids.optional(row.stockFulfilledById);
  }
  for (const row of data.associates) {
    row.payableAccountId = ids.optional(row.payableAccountId);
    row.profile.partyIds = row.profile.partyIds.map(ids.id);
    row.profile.fields = Object.fromEntries(
      Object.entries(row.profile.fields).map(([id, value]) => [
        ids.id(id),
        value,
      ]),
    );
    if (row.profile.commission) {
      row.profile.commission.payableAccountId = ids.id(
        row.profile.commission.payableAccountId,
      );
      row.profile.commission.itemIds = row.profile.commission.itemIds.map(
        ids.id,
      );
    }
  }
  for (const row of data.associateRules) {
    row.associateId = ids.id(row.associateId);
    commission(row.snapshot, ids);
  }
  for (const row of data.deliveryAssignments) {
    row.associateId = ids.id(row.associateId);
    row.voucherId = ids.id(row.voucherId);
    delivery(row.snapshot, ids);
  }
  for (const row of data.commissionAccruals) {
    row.associateId = ids.id(row.associateId);
    row.saleId = ids.id(row.saleId);
    commission(row.snapshot, ids);
  }
  for (const row of data.associatePayouts) {
    row.associateId = ids.id(row.associateId);
    row.ledgerId = ids.id(row.ledgerId);
  }
  for (const row of data.commissionPayoutAllocations) {
    row.payoutId = ids.id(row.payoutId);
    row.accrualId = ids.id(row.accrualId);
  }
  for (const row of data.associateJournals) {
    row.journalId = ids.id(row.journalId);
    row.sourceVoucherId = ids.optional(row.sourceVoucherId);
    row.payoutId = ids.optional(row.payoutId);
  }
  for (const row of data.commissionEntries) {
    row.associateId = ids.id(row.associateId);
    for (const key of [
      "accrualId",
      "sourceVoucherId",
      "payoutId",
      "journalId",
    ] as const)
      row[key] = ids.optional(row[key]);
    row.eventKey = row.eventKey
      .split(":")
      .map((part) => ids.records.get(part) ?? part)
      .join(":");
  }
  for (const row of data.associateEvents) {
    row.associateId = ids.optional(row.associateId);
    row.userId = ids.actor(row.userId);
    row.userName = `[Imported] ${row.userName}`;
  }
}

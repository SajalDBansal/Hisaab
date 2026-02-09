import type { FirmExportData } from "@repo/contracts";
import { AppError } from "@repo/backend/lib/app-error";

const invalid = () =>
  new AppError(
    "INVALID_BACKUP",
    "The export contains a broken business reference.",
    400,
  );

// A reference names its exact target table; an unrelated same-firm UUID is not sufficient.
const references = {
  settlementEntries: {
    voucherId: "vouchers",
    partyId: "parties",
    sourceVoucherId: "vouchers",
    sourceEntryId: "settlementEntries",
    loanId: "loans",
    interestAccountId: "accounts",
  },
  settlementAllocations: {
    entryId: "settlementEntries",
    voucherId: "vouchers",
    billId: "vouchers",
    openingPartyId: "parties",
    openingBillId: "openingBills",
  },
  creditApprovals: { partyId: "parties" },
  creditApprovalUses: { approvalId: "creditApprovals", voucherId: "vouchers" },
  orderSourceLines: { sourceId: "vouchers" },
  orderFulfillments: { sourceId: "vouchers" },
  orderFulfillmentLines: {
    fulfillmentId: "orderFulfillments",
    sourceLineId: "orderSourceLines",
    targetId: "vouchers",
    stockFulfilledById: "vouchers",
  },
  associates: { payableAccountId: "accounts" },
  associateRules: { associateId: "associates" },
  deliveryAssignments: { associateId: "associates", voucherId: "vouchers" },
  commissionAccruals: { associateId: "associates", saleId: "vouchers" },
  associatePayouts: { associateId: "associates", ledgerId: "ledgers" },
  commissionPayoutAllocations: {
    payoutId: "associatePayouts",
    accrualId: "commissionAccruals",
  },
  associateJournals: {
    journalId: "vouchers",
    sourceVoucherId: "vouchers",
    payoutId: "associatePayouts",
  },
  commissionEntries: {
    associateId: "associates",
    accrualId: "commissionAccruals",
    sourceVoucherId: "vouchers",
    payoutId: "associatePayouts",
    journalId: "vouchers",
  },
  associateEvents: { associateId: "associates" },
  importedOpeningBalances: { batchId: "masterImportBatches" },
  openingBills: { batchId: "masterImportBatches", partyId: "parties" },
} as const;

export function validateExtendedLinks(data: FirmExportData) {
  const tables = new Map<string, Set<string>>();
  for (const [name, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const rows = value.filter(
      (row): row is typeof row & { id: string } => "id" in row,
    );
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length) throw invalid();
    tables.set(name, ids);
  }
  const check = (value: string | null | undefined, table: string) => {
    if (value && !tables.get(table)?.has(value)) throw invalid();
  };
  for (const [name, fields] of Object.entries(references))
    for (const row of data[name as keyof typeof references])
      for (const [field, target] of Object.entries(fields))
        check((row as unknown as Record<string, string | null>)[field], target);
  for (const row of data.importedOpeningBalances)
    check(
      row.targetId,
      { party: "parties", ledger: "ledgers", account: "accounts" }[
        row.targetKind
      ],
    );
  for (const row of data.allocations) check(row.openingBillId, "openingBills");
  for (const row of data.associates) {
    for (const id of row.profile.partyIds) check(id, "parties");
    for (const id of Object.keys(row.profile.fields))
      check(id, "associateFields");
    if (row.profile.commission) {
      check(row.profile.commission.payableAccountId, "accounts");
      for (const id of row.profile.commission.itemIds) check(id, "items");
    }
  }
  const commissions = [
    ...data.vouchers.map((row) => row.commission),
    ...data.associateRules.map((row) => row.snapshot),
    ...data.commissionAccruals.map((row) => row.snapshot),
  ];
  for (const value of commissions)
    if (value) {
      check(value.associateId, "associates");
      check(value.payableAccountId, "accounts");
      for (const id of value.itemIds) check(id, "items");
    }
  for (const value of [
    ...data.vouchers.map((row) => row.delivery),
    ...data.deliveryAssignments.map((row) => row.snapshot),
  ])
    if (value) check(value.associateId, "associates");
  for (const row of data.vouchers)
    if (row.inventoryAdjustment) {
      check(row.inventoryAdjustment.itemId, "items");
      check(row.inventoryAdjustment.reversesId, "vouchers");
    }
  for (const row of data.orderSourceLines) check(row.line.itemId, "items");
  for (const row of data.orderFulfillments) {
    if (row.response.id !== row.id || row.response.sourceId !== row.sourceId)
      throw invalid();
    for (const voucher of row.response.vouchers) check(voucher.id, "vouchers");
  }
}

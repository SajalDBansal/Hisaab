import { v7 as uuidv7 } from "uuid";
import { Id, type FirmExportData } from "@repo/contracts";
import { AppError } from "@repo/backend/lib/app-error";
import { remapExtendedBooks, remapIssuedSnapshot } from "./restore.extensions";

export function unsupported(message: string): never {
  throw new AppError("RESTORE_UNSUPPORTED", message, 422);
}

// Business IDs and historical actors have separate maps; actors never become login accounts.
export function restoreIds(data: FirmExportData) {
  const records = new Map<string, string>([[data.organization.id, uuidv7()]]);
  for (const value of Object.values(data)) {
    if (!Array.isArray(value)) continue;
    for (const row of value)
      if ("id" in row) {
        if (records.has(row.id))
          unsupported("Record IDs must be unique across the export.");
        records.set(row.id, uuidv7());
      }
  }
  const actors = new Map<string, string>();
  for (const value of [
    ...data.auditLog.map((r) => r.userId),
    ...data.bookControlEvents.map((r) => r.userId),
    ...data.loanEvents.map((r) => r.userId),
    ...data.masterImportBatches.map((r) => r.userId),
    ...data.settlementEntries.map((r) => r.userId),
    ...data.creditApprovals.map((r) => r.userId),
    ...data.creditApprovalUses.map((r) => r.userId),
    ...data.orderFulfillments.map((r) => r.userId),
    ...data.associateEvents.map((r) => r.userId),
    ...data.vouchers.map((r) => r.createdBy),
  ])
    if (value && !actors.has(value)) actors.set(value, uuidv7());
  const id = (value: string) =>
    records.get(value) ??
    unsupported("A referenced record is missing from the export.");
  const optional = (value: string | null) => (value ? id(value) : null);
  function actor(value: string): string;
  function actor(value: string | null): string | null;
  function actor(value: string | null) {
    return value
      ? (actors.get(value) ?? unsupported("A historical actor is missing."))
      : null;
  }
  const account = (key: string) => {
    const [kind, ...rest] = key.split(":");
    if (["party", "ledger", "account"].includes(kind))
      return `${kind}:${id(rest.join(":"))}`;
    return key;
  };
  const lots = new Map<string, string>();
  const lotItems = new Map<string, string>();
  for (const item of data.items)
    for (const lot of item.openingLots ?? []) {
      if (lots.has(lot.id) || records.has(lot.id))
        unsupported("Opening stock lot IDs must be unique.");
      lots.set(lot.id, uuidv7());
      lotItems.set(lot.id, item.id);
    }
  const purchases = new Set(
    data.vouchers.filter((r) => r.type === "purchase").map((r) => r.id),
  );
  for (const line of data.voucherLines)
    if (purchases.has(line.voucherId)) {
      const old =
        line.stockLotId ?? `purchase:${line.voucherId}:${line.position}`;
      if (lots.has(old)) unsupported("Purchase stock lot IDs are duplicated.");
      if (
        line.stockLotId &&
        !Id.safeParse(old).success &&
        old !== `purchase:${line.voucherId}:${line.position}`
      )
        unsupported(
          "This legacy stock-lot format is not supported for restore.",
        );
      lots.set(
        old,
        line.stockLotId
          ? uuidv7()
          : `purchase:${id(line.voucherId)}:${line.position}`,
      );
      lotItems.set(old, line.itemId);
    }
  function lot(value: string, itemId: string): string;
  function lot(value: string | null, itemId: string): string | null;
  function lot(value: string | null, itemId: string) {
    if (!value) return null;
    if (value === `opening:${itemId}`) return `opening:${id(itemId)}`;
    if (lotItems.get(value) !== itemId)
      unsupported("A stock lot belongs to a different item.");
    return (
      lots.get(value) ??
      unsupported("A stock lot is not defined by this export's purchases.")
    );
  }
  return { id, optional, actor, account, lot, records, actors, lots };
}

export function remapBooks(source: FirmExportData, name: string) {
  const ids = restoreIds(source);
  const data = structuredClone(source);
  const firmId = ids.id(source.organization.id);
  data.organization = { ...data.organization, id: firmId, name };
  for (const [key, value] of Object.entries(data)) {
    if (key === "organization" || value === null) continue;
    for (const row of Array.isArray(value) ? value : [value]) {
      if ("firmId" in row) row.firmId = firmId;
      if ("id" in row) row.id = ids.id(row.id);
    }
  }
  data.invoiceSettings.bankLedgerId = ids.optional(
    data.invoiceSettings.bankLedgerId,
  );
  data.reminderSettings.enabled = false;
  for (const row of data.loans) row.accountId = ids.id(row.accountId);
  for (const row of data.loanRepaymentReferences) {
    row.loanId = ids.id(row.loanId);
    row.voucherId = ids.id(row.voucherId);
  }
  for (const row of data.loanEvents) row.loanId = ids.id(row.loanId);
  for (const row of data.masterImportBatches) {
    row.userId =
      ids.actor(row.userId) ?? unsupported("An import actor is missing.");
    row.result.batchId = ids.id(row.result.batchId);
    row.result.createdIds = row.result.createdIds.map((id) =>
      row.kind === "opening-stock"
        ? (ids.lots.get(id) ?? unsupported("An imported stock lot is missing."))
        : ids.id(id),
    );
    for (const lot of row.result.stockLots ?? []) {
      lot.id = ids.lot(lot.id, lot.itemId);
      lot.itemId = ids.id(lot.itemId);
    }
    for (const party of row.result.reconciliation?.parties ?? [])
      party.partyId = ids.id(party.partyId);
  }
  for (const row of data.openingAccounts)
    row.account = ids.account(row.account);
  for (const row of data.vouchers) {
    for (const key of [
      "partyId",
      "ledgerId",
      "toLedgerId",
      "againstId",
      "sourceId",
      "convertedToId",
    ] as const)
      row[key] = ids.optional(row[key]);
    row.createdBy = ids.actor(row.createdBy);
    if (row.bankClearings)
      row.bankClearings = Object.fromEntries(
        Object.entries(row.bankClearings).map(([id, date]) => [
          ids.id(id),
          date,
        ]),
      );
    if (row.snapshot) remapIssuedSnapshot(row.snapshot, ids);
  }
  for (const rows of [
    data.voucherLines,
    data.voucherCharges,
    data.journalLines,
    data.allocations,
    data.postings,
    data.stockMovements,
    data.auditLog,
  ])
    for (const row of rows) row.voucherId = ids.id(row.voucherId);
  for (const row of data.voucherLines) {
    row.stockLotId = ids.lot(row.stockLotId, row.itemId);
    row.itemId = ids.id(row.itemId);
  }
  for (const row of data.stockMovements) row.itemId = ids.id(row.itemId);
  for (const row of [...data.journalLines, ...data.postings])
    row.account = ids.account(row.account);
  for (const row of data.allocations) {
    row.billId = ids.optional(row.billId);
    row.openingPartyId = ids.optional(row.openingPartyId);
    row.openingBillId = ids.optional(row.openingBillId);
  }
  for (const row of data.remindersSent) row.partyId = ids.id(row.partyId);
  for (const row of data.documents) {
    row.partyId = ids.optional(row.partyId);
    row.voucherId = ids.optional(row.voucherId);
    if (row.accountKey) row.accountKey = ids.account(row.accountKey);
    row.s3Key = null;
    row.thumbnailKey = null;
    row.readyAt = null;
  }
  for (const row of [
    ...data.auditLog,
    ...data.bookControlEvents,
    ...data.loanEvents,
  ]) {
    row.userId =
      ids.actor(row.userId) ?? unsupported("Missing historical actor.");
    if (!row.userName.startsWith("[Imported] "))
      row.userName = `[Imported] ${row.userName}`;
  }
  remapExtendedBooks(data, source, ids);
  return { data, ids, firmId };
}

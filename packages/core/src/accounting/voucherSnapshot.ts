import type { Db } from "../mock/db";
import type { InvoiceLine, VoucherSnapshot } from "../types";

/** Copy only the masters used by this document, never references to editable objects. */
export function captureVoucherSnapshot(
  db: Db,
  partyId: string | undefined,
  lines: InvoiceLine[] = [],
  source: VoucherSnapshot["source"] = "issued",
): VoucherSnapshot {
  const itemIds = new Set(lines.map((line) => line.itemId));
  return structuredClone({
    source,
    firm: db.firm,
    party: db.parties.find((party) => party.id === partyId),
    items: db.items.filter((item) => itemIds.has(item.id)),
    units: db.units,
    settings: db.invoiceSettings,
    bankName: db.ledgers.find(
      (ledger) => ledger.id === db.invoiceSettings.bankLedgerId,
    )?.name,
  });
}

/** An edit retains existing master details; newly selected parties/items use today's masters. */
export function editedVoucherSnapshot(
  db: Db,
  previous: VoucherSnapshot | undefined,
  partyId: string,
  lines: InvoiceLine[],
): VoucherSnapshot {
  const current = captureVoucherSnapshot(db, partyId, lines);
  if (!previous) return current;
  return structuredClone({
    ...previous,
    party: previous.party?.id === partyId ? previous.party : current.party,
    items: current.items.map(
      (item) => previous.items.find((old) => old.id === item.id) ?? item,
    ),
    units: [
      ...previous.units,
      ...current.units.filter(
        (unit) => !previous.units.some((old) => old.name === unit.name),
      ),
    ],
  });
}

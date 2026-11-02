import type { InvoiceLine, Item, Voucher } from "../types";
import { bookScopeOf } from "./bookScope";
import { baseQty } from "./stockInputs";
import { stockLots } from "./stockLots";

function laterThan(voucher: Voucher, note: Voucher) {
  return (
    voucher.date > note.date ||
    (voucher.date === note.date && voucher.createdAt > note.createdAt)
  );
}

function movesLot(voucher: Voucher, line: InvoiceLine) {
  if (voucher.inventoryAdjustment)
    return voucher.inventoryAdjustment.lotId === line.stockLotId;
  if (
    !["sale", "credit-note", "debit-note", "delivery-note"].includes(
      voucher.type,
    )
  )
    return false;
  if (
    voucher.type === "delivery-note" &&
    voucher.convertedToId &&
    !voucher.fulfillmentManaged
  )
    return false;
  return voucher.lines?.some(
    (row) =>
      row.itemId === line.itemId &&
      !(voucher.type === "sale" && row.stockFulfilledById) &&
      (row.stockLotId
        ? row.stockLotId === line.stockLotId
        : (row.bookScope ?? bookScopeOf(voucher)) === line.bookScope),
  );
}

// Later frozen sales and adjustments cannot absorb a newly backdated return's cost or rounding.
function assertLatest(vouchers: Voucher[], note: Voucher, line: InvoiceLine) {
  if (
    vouchers.some(
      (voucher) =>
        voucher.status === "posted" &&
        laterThan(voucher, note) &&
        movesLot(voucher, line),
    )
  )
    throw new Error(
      "Use a date on or after the latest stock movement for this purchase lot.",
    );
}

// Integer products retain every paise even when the amount and quantity are large.
function carryingCost(value: number, qty: number, available: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(
      "Resolve the stock lot's value before returning these goods.",
    );
  const part = BigInt(Math.round(qty * 1000));
  const total = BigInt(Math.round(available * 1000));
  return Number((BigInt(value) * part + total / 2n) / total);
}

/** Save carrying cost separately from the supplier credit calculated from the original bill. */
export function purchaseReturnLines(
  items: Item[],
  vouchers: Voucher[],
  note: Voucher,
): InvoiceLine[] {
  const lines = note.lines ?? [];
  const prior = vouchers.filter(
    (voucher) => voucher.id !== note.id && !laterThan(voucher, note),
  );
  const lots = items
    .filter((item) => lines.some((line) => line.itemId === item.id))
    .flatMap((item) => stockLots(item, prior, note.date));
  return lines.map((line) => {
    const lot = lots.find(
      (row) => row.itemId === line.itemId && row.id === line.stockLotId,
    );
    const scope = line.bookScope ?? bookScopeOf(note);
    if (!lot || lot.bookScope !== scope)
      throw new Error("Choose the original purchase stock lot in this book.");
    assertLatest(vouchers, note, { ...line, bookScope: scope });
    const qty = baseQty(line);
    if (!Number.isFinite(qty) || qty <= 0 || qty > lot.qty)
      throw new Error(
        `Only ${lot.qty} units remain in ${lot.number} on this date.`,
      );
    const stockCost = carryingCost(lot.value, qty, lot.qty);
    lot.qty = (Math.round(lot.qty * 1000) - Math.round(qty * 1000)) / 1000;
    lot.value -= stockCost;
    return { ...line, stockCost, bookScope: scope };
  });
}

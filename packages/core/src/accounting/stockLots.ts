import type { BookScope, InvoiceLine, Item, TaxScope, Voucher } from "../types";
import { mulDivRound, thousandths } from "../money";
import { calcLine } from "./invoice";
import { baseQty, stockVouchersAsOf } from "./stockInputs";
import { bookScopeOf } from "./bookScope";

export interface StockLot {
  id: string;
  itemId: string;
  number: string;
  date: string;
  bookScope: BookScope;
  qty: number;
  value: number;
  unitCost: number;
  minimumQty: number;
}

const quantity = (n: number) => Math.round(n * 1000) / 1000;
export const purchaseLotId = (v: Voucher, index: number) =>
  v.lines?.[index]?.stockLotId ?? `purchase:${v.id}:${index}`;

/** Recover the saved acquisition cost; older purchases use their own invoice amounts. */
export function purchaseLineCost(
  line: InvoiceLine,
  v: Pick<Voucher, "taxMode" | "interState">,
) {
  const total = calcLine(line, !!v.interState);
  return total.taxable + (v.taxMode && v.taxMode !== "regular" ? total.tax : 0);
}

interface StockAllocation {
  lot: StockLot;
  qty: number;
  cost: number;
}

/** Remove selected stock, preserving a visible deficit for legacy entries with missing purchases. */
function consumeStock(
  lots: StockLot[],
  line: InvoiceLine,
  scope: BookScope,
  lotId?: string,
  purchaseReturn = false,
) {
  let left = baseQty(line);
  const used: StockAllocation[] = [];
  const candidates = lotId
    ? lots.filter((lot) => lot.id === lotId)
    : lots.filter((lot) => lot.bookScope === scope && lot.qty > 0);
  const take = (lot: StockLot, qty: number, cost: number) => {
    lot.qty = quantity(lot.qty - qty);
    lot.value -= cost;
    lot.minimumQty = Math.min(lot.minimumQty, lot.qty);
    used.push({ lot, qty, cost });
    left = quantity(left - qty);
  };
  for (const lot of candidates) {
    const qty = lotId ? left : Math.min(left, lot.qty);
    // Depleting returns release all carrying cost; issued sale and partial-return costs stay frozen.
    const cost =
      purchaseReturn && qty === lot.qty
        ? lot.value
        : line.stockCost !== undefined && lotId
          ? line.stockCost
          : qty === lot.qty
            ? lot.value
            : Math.round(qty * lot.unitCost);
    take(lot, qty, cost);
    if (left <= 0) break;
  }
  if (left > 0) take(lots[0], left, Math.round(left * lots[0].unitCost));
  return used;
}

/** Reverse original allocations; cumulative rounding makes several partial returns equal one full return. */
function restoreStock(
  lots: StockLot[],
  line: InvoiceLine,
  allocations: StockAllocation[],
  sourceQty: number,
  previouslyReturned: number,
) {
  const qty = baseQty(line);
  const namedLot = lots.find((lot) => lot.id === line.stockLotId);
  const proportional = (amount: number, round: (n: number) => number) =>
    round((amount * (previouslyReturned + qty)) / sourceQty) -
    round((amount * previouslyReturned) / sourceQty);
  const restored = namedLot
    ? [
        {
          lot: namedLot,
          qty,
          cost: line.stockCost ?? Math.round(qty * namedLot.unitCost),
        },
      ]
    : allocations.map((a) => ({
        lot: a.lot,
        qty: proportional(a.qty, quantity),
        cost: proportional(a.cost, Math.round),
      }));
  for (const allocation of restored) {
    allocation.lot.qty = quantity(allocation.lot.qty + allocation.qty);
    allocation.lot.value += allocation.cost;
    if (allocation.lot.qty > 0)
      allocation.lot.unitCost = allocation.lot.value / allocation.lot.qty;
  }
  return restored.reduce((sum, allocation) => sum + allocation.cost, 0);
}

/** Replay stock by lot; legacy sales consume FIFO without rewriting their issued invoices. */
export function stockLots(
  item: Item,
  vouchers: Voucher[],
  asOf?: string,
  costs?: Map<string, number>,
): StockLot[] {
  const openingScope =
    item.openingBookScope ?? (item.taxType === "nongst" ? "nongst" : "gst");
  const openingCost = item.openingCost ?? item.purchasePrice;
  const lots: StockLot[] = item.openingLots?.length
    ? item.openingLots.map((lot) => ({
        ...lot,
        itemId: item.id,
        number: "Opening stock",
        date: "0001-01-01",
        value: Math.round(lot.qty * lot.unitCost),
        minimumQty: lot.qty,
      }))
    : [
        {
          id: `opening:${item.id}`,
          itemId: item.id,
          number: "Opening stock",
          date: "0001-01-01",
          bookScope: openingScope,
          qty: item.openingStock,
          value: Math.round(item.openingStock * openingCost),
          unitCost: openingCost,
          minimumQty: item.openingStock,
        },
      ];
  const rows = (asOf ? stockVouchersAsOf(vouchers, asOf) : vouchers)
    .filter((v) => v.status === "posted")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
    );
  const consumed = new Map<string, StockAllocation[]>();
  const returned = new Map<string, number>();
  const byId = new Map(vouchers.map((v) => [v.id, v]));
  for (const v of rows) {
    const adjustment = v.inventoryAdjustment;
    if (adjustment?.itemId === item.id) {
      const lot = lots.find((row) => row.id === adjustment.lotId);
      if (lot) {
        lot.qty = quantity(lot.qty + adjustment.quantity);
        lot.value += adjustment.value;
        lot.minimumQty = Math.min(lot.minimumQty, lot.qty);
        if (lot.qty) lot.unitCost = lot.value / lot.qty;
      }
      continue;
    }
    const inward = v.type === "purchase";
    const outward =
      v.type === "sale" ||
      v.type === "debit-note" ||
      (v.type === "delivery-note" &&
        (!v.convertedToId || v.fulfillmentManaged));
    if (!inward && !outward && v.type !== "credit-note") continue;
    for (const [index, line] of (v.lines ?? []).entries()) {
      if (line.itemId !== item.id) continue;
      const qty = baseQty(line);
      const scope = line.bookScope ?? bookScopeOf(v);
      if (v.type === "sale" && line.stockFulfilledById) {
        const lot = lots.find((row) => row.id === line.stockLotId);
        const cost = line.stockCost ?? 0;
        if (lot) consumed.set(`${v.id}:${index}`, [{ lot, qty, cost }]);
        costs?.set(`${v.id}:${index}`, cost);
        continue;
      }
      if (inward) {
        const cost = line.stockCost ?? purchaseLineCost(line, v);
        lots.push({
          id: purchaseLotId(v, index),
          itemId: item.id,
          number: v.number,
          date: v.date,
          bookScope: scope,
          qty,
          value: cost,
          unitCost: qty ? cost / qty : 0,
          minimumQty: qty,
        });
        continue;
      }
      const source = v.againstId ? byId.get(v.againstId) : undefined;
      const sourceIndex = line.sourceLine ?? index;
      const lotId =
        line.stockLotId ??
        (v.type === "debit-note" && source
          ? purchaseLotId(source, sourceIndex)
          : undefined);
      if (v.type === "credit-note") {
        const sourceKey = `${v.againstId}:${sourceIndex}`;
        const allocations = consumed.get(sourceKey) ?? [];
        const sourceQty = source?.lines?.[sourceIndex]
          ? baseQty(source.lines[sourceIndex])
          : qty;
        const prior = returned.get(sourceKey) ?? 0;
        const cost = restoreStock(lots, line, allocations, sourceQty, prior);
        returned.set(sourceKey, quantity(prior + qty));
        costs?.set(`${v.id}:${index}`, cost);
        continue;
      }
      const used = consumeStock(
        lots,
        line,
        scope,
        lotId,
        v.type === "debit-note",
      );
      consumed.set(`${v.id}:${index}`, used);
      costs?.set(
        `${v.id}:${index}`,
        used.reduce((sum, a) => sum + a.cost, 0),
      );
    }
  }
  return lots;
}

export function inventoryValue(
  item: Item,
  vouchers: Voucher[],
  scope: TaxScope = "all",
) {
  return stockLots(item, vouchers)
    .filter((l) => scope === "all" || l.bookScope === scope)
    .reduce((sum, l) => sum + l.value, 0);
}

/** Shown when an item has stock in both books and the sale didn't say which to use. */
export const STOCK_BOOK_CHOICE_MESSAGE =
  "This item has stock in both the GST and non-GST books. Choose which stock to sell from.";

/**
 * Give each sale line its stock. A chosen lot is used as is; otherwise stock comes
 * oldest first (FIFO) from the line's book, or the only book holding the item.
 * A line needing several lots becomes one line per lot, so returns, cancellations
 * and costs keep working lot by lot; prints merge them back into one row.
 * `available` is copied, so callers can pass cached lots.
 */
export function allocateStock(
  available: StockLot[],
  lines: InvoiceLine[],
): InvoiceLine[] {
  const pool = available.map((lot) => ({ ...lot }));
  const take = (lot: StockLot, line: InvoiceLine, qty: number) => {
    const stockCost =
      qty === lot.qty ? lot.value : Math.round(qty * lot.unitCost);
    lot.qty = quantity(lot.qty - qty);
    lot.value -= stockCost;
    return { ...line, stockLotId: lot.id, stockCost, bookScope: lot.bookScope };
  };
  return lines.flatMap((line) => {
    const choices = pool.filter((l) => l.itemId === line.itemId && l.qty > 0);
    const qty = baseQty(line);
    if (line.stockLotId) {
      const lot = choices.find((l) => l.id === line.stockLotId);
      if (!lot)
        throw new Error(
          choices.length
            ? "The chosen stock batch has no stock left on this date. Choose another batch."
            : "No stock available on this date. Record the purchase first.",
        );
      if (qty > lot.qty)
        throw new Error(`Only ${lot.qty} units remain in ${lot.number}.`);
      return [take(lot, line, qty)];
    }
    if (!choices.length)
      throw new Error(
        "No stock available on this date. Record the purchase first.",
      );
    const scopes = [...new Set(choices.map((l) => l.bookScope))];
    const scope =
      line.bookScope ?? (scopes.length === 1 ? scopes[0] : undefined);
    if (!scope) throw new Error(STOCK_BOOK_CHOICE_MESSAGE);
    const fifo = choices.filter((l) => l.bookScope === scope);
    const inStock = quantity(fifo.reduce((sum, l) => sum + l.qty, 0));
    if (qty > inStock)
      throw new Error(
        `Only ${inStock} units are in ${scope === "gst" ? "GST" : "non-GST"} stock on this date.`,
      );
    const parts: { lot: StockLot; qty: number }[] = [];
    let left = qty;
    for (const lot of fifo) {
      if (left <= 0) break;
      const used = quantity(Math.min(left, lot.qty));
      parts.push({ lot, qty: used });
      left = quantity(left - used);
    }
    if (parts.length === 1) return [take(parts[0].lot, line, qty)];
    // Split in the unit the line was entered in; the flat discount follows quantity.
    const factor = line.per?.factor ?? 1;
    let done = 0;
    let discountGiven = 0;
    return parts.map((part, index) => {
      const partQty = quantity(part.qty / factor);
      if (Math.abs(partQty * factor - part.qty) > 1e-9)
        throw new Error(
          `This quantity uses more than one stock batch and can't be split in ${line.per?.unit}. Enter it in the item's base unit or choose a batch.`,
        );
      done = quantity(done + part.qty);
      let discountAmount = line.discountAmount;
      if (line.discountAmount !== undefined) {
        const upTo =
          index === parts.length - 1
            ? line.discountAmount
            : mulDivRound(
                line.discountAmount,
                thousandths(done),
                thousandths(qty),
              );
        discountAmount = upTo - discountGiven;
        discountGiven = upTo;
      }
      return take(
        part.lot,
        { ...line, qty: partQty, discountAmount },
        part.qty,
      );
    });
  });
}

/** Select stock for sale lines from the books as they stood on `date`. */
export function selectStockLines(
  items: Item[],
  vouchers: Voucher[],
  lines: InvoiceLine[],
  date: string,
): InvoiceLine[] {
  return allocateStock(
    items.flatMap((i) => stockLots(i, vouchers, date)),
    lines,
  );
}

/** Backdated entries must also leave enough stock for already-issued later invoices. */
export function assertLotsAvailable(
  items: Item[],
  vouchers: Voucher[],
  ids: string[],
) {
  for (const item of items)
    for (const lot of stockLots(item, vouchers)) {
      if (ids.includes(lot.id) && lot.minimumQty < 0)
        throw new Error(
          `Stock in ${lot.number} is already used by another entry. Review its sales and returns first.`,
        );
    }
}

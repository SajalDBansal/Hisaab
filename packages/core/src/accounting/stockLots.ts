import type { BookScope, InvoiceLine, Item, TaxScope, Voucher } from "../types";
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
    const cost =
      line.stockCost !== undefined && lotId
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
    if (allocation.lot.qty > 0) allocation.lot.unitCost = allocation.lot.value / allocation.lot.qty;
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
  const lots: StockLot[] = item.openingLots?.length ? item.openingLots.map((lot) => ({
    ...lot,
    itemId: item.id,
    number: "Opening stock",
    date: "0001-01-01",
    value: Math.round(lot.qty * lot.unitCost),
    minimumQty: lot.qty,
  })) : [
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
      (v.type === "delivery-note" && (!v.convertedToId || v.fulfillmentManaged));
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
      const used = consumeStock(lots, line, scope, lotId);
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

/** Select a real lot and reserve quantities across repeated rows in the same bill. */
export function selectStockLines(
  items: Item[],
  vouchers: Voucher[],
  lines: InvoiceLine[],
  date: string,
): InvoiceLine[] {
  const available = items.flatMap((i) => stockLots(i, vouchers, date));
  return lines.map((line) => {
    const choices = available.filter(
      (l) => l.itemId === line.itemId && l.qty > 0,
    );
    const equivalent = choices.every(
      (l) =>
        l.bookScope === choices[0]?.bookScope &&
        l.unitCost === choices[0]?.unitCost,
    );
    const lot = line.stockLotId
      ? choices.find((l) => l.id === line.stockLotId)
      : equivalent
        ? (choices.find((l) => l.qty >= baseQty(line)) ?? choices[0])
        : undefined;
    if (!lot)
      throw new Error(
        choices.length
          ? "Choose the purchase stock lot for each sale item."
          : "No stock available on this date. Record the purchase first.",
      );
    const qty = baseQty(line);
    if (qty > lot.qty)
      throw new Error(`Only ${lot.qty} units remain in ${lot.number}.`);
    const stockCost =
      qty === lot.qty ? lot.value : Math.round(qty * lot.unitCost);
    lot.qty = quantity(lot.qty - qty);
    lot.value -= stockCost;
    return { ...line, stockLotId: lot.id, stockCost, bookScope: lot.bookScope };
  });
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

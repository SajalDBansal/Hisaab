/**
 * Stock quantities and values, worked out from opening stock and posted vouchers.
 */
import type { ISODate, InvoiceLine, Item, Paise, Voucher } from "../types";
import { thousandths } from "../money";
import { isPosted } from "./bills";
import { calcLine } from "./invoice";
import { stockLots } from "./stockLots";
import { baseQty } from "./stockInputs";
export { baseQty, stockVouchersAsOf } from "./stockInputs";

export interface StockMovement {
  voucherId: string;
  number: string;
  date: ISODate;
  type:
    | "sale"
    | "purchase"
    | "credit-note"
    | "debit-note"
    | "delivery-note"
    | "journal";
  /** Positive for stock in, negative for stock out (base units). */
  qty: number;
  /** How it was entered on the bill when not in the base unit, e.g. "2 Box". */
  entered?: string;
}

/** How a bill line's quantity reads: { main: "2 Box", base: "24 Pcs" } or { main: "5 Pcs" }. */
export function lineQtyText(
  line: InvoiceLine,
  baseUnit: string,
): { main: string; base?: string } {
  if (!line.per) return { main: `${line.qty} ${baseUnit}` };
  return {
    main: `${line.qty} ${line.per.unit}`,
    base: `${baseQty(line)} ${baseUnit}`,
  };
}

export function stockMovements(
  itemId: string,
  vouchers: Voucher[],
): StockMovement[] {
  const rows: StockMovement[] = [];
  for (const v of vouchers) {
    if (isPosted(v) && v.inventoryAdjustment?.itemId === itemId) {
      rows.push({
        voucherId: v.id,
        number: v.number,
        date: v.date,
        type: "journal",
        qty: v.inventoryAdjustment.quantity,
      });
      continue;
    }
    // Stock comes in on purchases and sales returns, goes out on sales and purchase returns
    const inward = v.type === "purchase" || v.type === "credit-note";
    // A delivery challan moves stock out until it is billed; then the invoice does
    const outward =
      v.type === "sale" ||
      v.type === "debit-note" ||
      (v.type === "delivery-note" &&
        (!v.convertedToId || v.fulfillmentManaged));
    if (!isPosted(v) || (!inward && !outward)) continue;
    for (const line of v.lines ?? []) {
      if (line.itemId !== itemId) continue;
      if (v.type === "sale" && line.stockFulfilledById) continue;
      rows.push({
        voucherId: v.id,
        number: v.number,
        date: v.date,
        type: v.type as StockMovement["type"],
        qty: inward ? baseQty(line) : -baseQty(line),
        entered: line.per ? `${line.qty} ${line.per.unit}` : undefined,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function stockQty(item: Item, vouchers: Voucher[]): number {
  return stockMovements(item.id, vouchers).reduce(
    (q, m) => q + m.qty,
    item.openingStock,
  );
}

/** Value an opening quantity at its frozen cost, never the current buying default. */
export function stockValue(item: Item, qty: number): Paise {
  if (item.openingLots) {
    const total = item.openingLots.reduce(
      (sum, lot) => sum + Math.round(lot.qty * lot.unitCost),
      0,
    );
    return item.openingStock
      ? Math.round((total * qty) / item.openingStock)
      : 0;
  }
  return Math.round(qty * (item.openingCost ?? item.purchasePrice));
}

export function isLowStock(item: Item, qty: number): boolean {
  return qty < item.reorderLevel;
}

/** Stock in the second unit: 30 Nos with 1 Box = 12 → "2 Box 6 Nos". Null when it's less than one box. */
export function altQtyText(item: Item, qty: number): string | null {
  if (!item.altUnit || Math.abs(qty) < item.altUnit.factor) return null;
  // Whole thousandths avoid leftovers like "6.100000000000001 Nos".
  const q = thousandths(qty);
  const factor = thousandths(item.altUnit.factor);
  const boxes = Math.trunc(q / factor);
  const rest = (q - boxes * factor) / 1000;
  return `${boxes} ${item.altUnit.name}${rest ? ` ${rest} ${item.unit}` : ""}`;
}

/** "30 Nos · 2 Box 6 Nos" — base units, then boxes when the item has a second unit. */
export function formatQty(item: Item, qty: number): string {
  const alt = altQtyText(item, qty);
  return `${qty} ${item.unit}${alt ? ` · ${alt}` : ""}`;
}

/** Sales value and cost for an item, for a simple item-wise profit figure. */
export function itemProfit(item: Item, vouchers: Voucher[]) {
  let soldQty = 0;
  let salesValue = 0;
  let cost = 0;
  const costs = new Map<string, number>();
  stockLots(item, vouchers, undefined, costs);
  for (const v of vouchers) {
    // Sales count up, sales returns (credit notes) count back down
    const sign = v.type === "sale" ? 1 : v.type === "credit-note" ? -1 : 0;
    if (!isPosted(v) || !sign) continue;
    for (const [index, line] of (v.lines ?? []).entries()) {
      if (line.itemId !== item.id) continue;
      soldQty += sign * baseQty(line);
      salesValue += sign * calcLine(line, !!v.interState).taxable;
      cost += sign * (costs.get(`${v.id}:${index}`) ?? 0);
    }
  }
  return { soldQty, salesValue, cost, profit: salesValue - cost };
}

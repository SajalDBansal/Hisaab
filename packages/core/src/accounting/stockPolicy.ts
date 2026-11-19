/**
 * Stock control (doc 37, T37). Costing is automatic FIFO, so a sale always needs
 * a purchase lot (or opening stock) for every unit it sells: true negative stock
 * is never allowed, under either policy. The firm's policy decides what the
 * minimum stock level (`reorderLevel`) does to a new sale:
 *   warn  — (default) the sale form warns when a line takes more than the stock
 *           in hand, or leaves less than the minimum; the sale is still saved
 *           when the stock is there.
 *   block — a new sale that leaves an item below its minimum level is refused.
 * Edits of existing sales are never blocked by the minimum.
 */
import type { InvoiceLine, Item, Voucher } from "../types";
import { baseQty, stockQty, tracksStock } from "./stock";
import type { StockLot } from "./stockLots";

export const STOCK_POLICIES = ["warn", "block"] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];
export const DEFAULT_STOCK_POLICY: StockPolicy = "warn";

export interface MinimumShortfall {
  itemId: string;
  name: string;
  unit: string;
  /** Stock left once the vouchers are saved, in the base unit. */
  left: number;
  minimum: number;
}

/** Goods on `lines` whose stock after `vouchers` (which include the sale) is under the minimum. */
export function belowMinimum(
  items: Item[],
  vouchers: Voucher[],
  lines: Pick<InvoiceLine, "itemId">[],
): MinimumShortfall[] {
  const ids = new Set(lines.map((l) => l.itemId));
  return items
    .filter((i) => ids.has(i.id) && tracksStock(i) && i.reorderLevel > 0)
    .flatMap((item) => {
      const left = stockQty(item, vouchers);
      return left < item.reorderLevel
        ? [
            {
              itemId: item.id,
              name: item.name,
              unit: item.unit,
              left,
              minimum: item.reorderLevel,
            },
          ]
        : [];
    });
}

export const belowMinimumMessage = (s: MinimumShortfall) =>
  `${s.name} would go below its minimum stock of ${s.minimum} ${s.unit} (${s.left} ${s.unit} left). Stock control blocks such sales; buy more or change the setting.`;

/**
 * The sale form's warning for one line (doc 37, T37), or undefined: more than
 * the stock in hand on the bill date (always refused, FIFO), or leaving less
 * than the minimum level (refused under "block" for new sales).
 */
export function stockShortfallText(
  item: Item,
  lots: Pick<StockLot, "qty" | "bookScope">[],
  line: InvoiceLine,
  policy: StockPolicy = DEFAULT_STOCK_POLICY,
): string | undefined {
  if (!tracksStock(item)) return undefined;
  const held = lots.filter(
    (lot) =>
      lot.qty > 0 && (!line.bookScope || lot.bookScope === line.bookScope),
  );
  const inHand =
    Math.round(held.reduce((sum, l) => sum + l.qty, 0) * 1000) / 1000;
  const need = baseQty(line);
  if (need > inHand)
    return `Only ${inHand} ${item.unit} in stock on this date. Record the purchase first: sales can't take stock below zero.`;
  const left = Math.round((inHand - need) * 1000) / 1000;
  if (item.reorderLevel > 0 && left < item.reorderLevel)
    return policy === "block"
      ? `Leaves ${left} ${item.unit}, below the minimum of ${item.reorderLevel}. Stock control will refuse this sale.`
      : `Leaves ${left} ${item.unit}, below the minimum of ${item.reorderLevel}.`;
  return undefined;
}

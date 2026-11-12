import type { Item, Party, PartyType, Voucher } from "../types";
import { calcLine } from "./invoice";
import { baseQty } from "./stockInputs";
import { purchaseLotId, stockLots, vouchersByItem } from "./stockLots";

// Who supplies or buys each product, and at what rate. A rate is what one base
// unit cost or sold for on the bill: after the line discount, before GST.

/** One product bought from one supplier, or sold to one customer. */
export interface TradeRate {
  partyId: string;
  partyName: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  group: string;
  /** Base unit; every rate and quantity here is per this unit. */
  unit: string;
  /** Rate on the latest bill: per base unit, after line discount, before GST. */
  rate: number;
  /** The same bill's rate as typed, before the line discount. */
  typedRate: number;
  /** Rate on the bill before the latest one, to show a rise or fall. */
  previousRate: number | null;
  gstRate: number;
  lastDate: string;
  lastVoucherId: string;
  lastNumber: string;
  firstDate: string;
  /** Bills (purchases or sales) with this product. */
  bills: number;
  /** Bought or sold, less returns, in base units. */
  qty: number;
  /** Taxable value of those bills, less returns. */
  value: number;
  /** Suppliers only: stock still on hand from this supplier's purchases (FIFO). */
  stockQty: number | null;
  /** Suppliers only: cost of that stock. */
  stockValue: number | null;
}

/** One bill or return behind a rate. Newest first. */
export interface TradeRateEntry {
  voucherId: string;
  number: string;
  date: string;
  type: "purchase" | "sale" | "debit-note" | "credit-note";
  /** Base units; negative for returns. */
  qty: number;
  rate: number;
  typedRate: number;
  gstRate: number;
}

type Books = { items: Item[]; parties: Party[]; vouchers: Voucher[] };

const INVOICE: Record<PartyType, "purchase" | "sale"> = {
  supplier: "purchase",
  customer: "sale",
};
const RETURN: Record<PartyType, "debit-note" | "credit-note"> = {
  supplier: "debit-note",
  customer: "credit-note",
};
const quantity = (n: number) => Math.round(n * 1000) / 1000;
const paise = (n: number) => Math.round(n * 100) / 100;
const byBookOrder = (a: Voucher, b: Voucher) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

/** A bill's lines for one product, merged (sales split a line per stock lot). */
function entryOf(v: Voucher, itemId: string, sign: 1 | -1) {
  let qty = 0;
  let taxable = 0;
  let typed = 0;
  let gstRate = 0;
  for (const line of v.lines ?? []) {
    if (line.itemId !== itemId) continue;
    const base = baseQty(line);
    const totals = calcLine(line, !!v.interState);
    qty += base;
    taxable += totals.taxable;
    typed += totals.gross;
    gstRate = line.gstRate;
  }
  if (!qty) return null;
  return {
    voucherId: v.id,
    number: v.number,
    date: v.date,
    type: v.type as TradeRateEntry["type"],
    qty: quantity(sign * qty),
    rate: paise(taxable / qty),
    typedRate: paise(typed / qty),
    gstRate,
    taxable: sign * taxable,
  };
}

function relevant(v: Voucher, type: PartyType) {
  return (
    v.status === "posted" &&
    !!v.partyId &&
    (v.type === INVOICE[type] || v.type === RETURN[type])
  );
}

/** Every bill and return between one party and one product, newest first. */
export function tradeRateHistory(
  books: Pick<Books, "vouchers">,
  party: Pick<Party, "id" | "type">,
  itemId: string,
): TradeRateEntry[] {
  return books.vouchers
    .filter((v) => v.partyId === party.id && relevant(v, party.type))
    .sort(byBookOrder)
    .reverse()
    .flatMap((v) => {
      const entry = entryOf(v, itemId, v.type === RETURN[party.type] ? -1 : 1);
      if (!entry) return [];
      const { voucherId, number, date, type, qty, rate, typedRate, gstRate } =
        entry;
      return [{ voucherId, number, date, type, qty, rate, typedRate, gstRate }];
    });
}

/**
 * Stock on hand per supplier and product, from what is left of each purchase
 * lot after FIFO sales and returns. Opening stock has no supplier (key "").
 */
export function stockBySupplier(
  books: Pick<Books, "items" | "vouchers">,
  itemIds: Set<string>,
) {
  const lotParty = new Map<string, string>();
  for (const v of books.vouchers)
    if (v.type === "purchase" && v.partyId)
      (v.lines ?? []).forEach((line, index) => {
        if (itemIds.has(line.itemId))
          lotParty.set(purchaseLotId(v, index), v.partyId as string);
      });
  const byItem = vouchersByItem(books.vouchers);
  const stock = new Map<string, { qty: number; value: number }>();
  for (const item of books.items) {
    if (!itemIds.has(item.id)) continue;
    for (const lot of stockLots(item, byItem.get(item.id) ?? [])) {
      if (lot.qty <= 0) continue;
      const key = `${lotParty.get(lot.id) ?? ""}:${item.id}`;
      const row = stock.get(key) ?? { qty: 0, value: 0 };
      row.qty = quantity(row.qty + lot.qty);
      row.value += lot.value;
      stock.set(key, row);
    }
  }
  return stock;
}

/**
 * Rates per party and product, for one party's products or one product's
 * parties of a type. Latest bill first.
 */
export function tradeRates(
  books: Books,
  filter: { type: PartyType; partyId?: string; itemId?: string },
): TradeRate[] {
  const { type } = filter;
  const items = new Map(books.items.map((i) => [i.id, i]));
  const parties = new Map(books.parties.map((p) => [p.id, p]));
  const groups = new Map<
    string,
    {
      partyId: string;
      itemId: string;
      bills: NonNullable<ReturnType<typeof entryOf>>[];
      qty: number;
      value: number;
    }
  >();
  for (const v of [...books.vouchers].sort(byBookOrder)) {
    if (!relevant(v, type)) continue;
    if (filter.partyId && v.partyId !== filter.partyId) continue;
    const party = parties.get(v.partyId as string);
    if (!party || party.type !== type) continue;
    const isReturn = v.type === RETURN[type];
    const itemIds = new Set((v.lines ?? []).map((l) => l.itemId));
    for (const itemId of itemIds) {
      if (filter.itemId && itemId !== filter.itemId) continue;
      if (!items.has(itemId)) continue;
      const entry = entryOf(v, itemId, isReturn ? -1 : 1);
      if (!entry) continue;
      const key = `${v.partyId}:${itemId}`;
      const group = groups.get(key) ?? {
        partyId: v.partyId as string,
        itemId,
        bills: [],
        qty: 0,
        value: 0,
      };
      group.qty = quantity(group.qty + entry.qty);
      group.value += entry.taxable;
      if (!isReturn) group.bills.push(entry);
      groups.set(key, group);
    }
  }
  const stock =
    type === "supplier"
      ? stockBySupplier(
          books,
          new Set([...groups.values()].map((g) => g.itemId)),
        )
      : null;
  const rows: TradeRate[] = [];
  for (const group of groups.values()) {
    const latest = group.bills[group.bills.length - 1];
    if (!latest) continue; // Only returns: nothing to quote.
    const item = items.get(group.itemId) as Item;
    const held = stock?.get(`${group.partyId}:${group.itemId}`);
    rows.push({
      partyId: group.partyId,
      partyName: parties.get(group.partyId)?.name ?? "",
      itemId: item.id,
      itemName: item.name,
      itemCode: item.code,
      group: item.group,
      unit: item.unit,
      rate: latest.rate,
      typedRate: latest.typedRate,
      previousRate: group.bills[group.bills.length - 2]?.rate ?? null,
      gstRate: latest.gstRate,
      lastDate: latest.date,
      lastVoucherId: latest.voucherId,
      lastNumber: latest.number,
      firstDate: (group.bills[0] ?? latest).date,
      bills: group.bills.length,
      qty: group.qty,
      value: Math.round(group.value),
      stockQty: stock ? (held?.qty ?? 0) : null,
      stockValue: stock ? (held?.value ?? 0) : null,
    });
  }
  return rows.sort(
    (a, b) =>
      b.lastDate.localeCompare(a.lastDate) ||
      a.itemName.localeCompare(b.itemName),
  );
}

/** Opening stock still on hand for one product: it has no supplier. */
export function openingStockLeft(
  books: Pick<Books, "items" | "vouchers">,
  itemId: string,
) {
  return (
    stockBySupplier(books, new Set([itemId])).get(`:${itemId}`) ?? {
      qty: 0,
      value: 0,
    }
  );
}

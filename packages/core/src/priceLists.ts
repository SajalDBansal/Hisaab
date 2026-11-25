/**
 * Price lists (doc 37, T36): sale or purchase lists with a % markup/markdown
 * on the item's own price, or per-item rates. Pure rules shared by the API,
 * the app and the in-app demo.
 */
import type { ID, Item, Paise } from "./types";

export type PriceListSide = "sale" | "purchase";
/** `percent`: the item's sale (or purchase) price up or down by `percent`; `rates`: own rate per item. */
export type PriceListMode = "percent" | "rates";

/** One item's rate on a price list, per `unit` (the item's base unit when left out, or its second unit). */
export interface PriceListRate {
  itemId: ID;
  rate: Paise;
  unit?: string;
}

/**
 * A sale or purchase price list. Assigned to parties (or the firm default for
 * its side); the bill form's default rate for a line is the party's list
 * rate, else the item's own price.
 */
export interface PriceList {
  id: ID;
  name: string;
  side: PriceListSide;
  mode: PriceListMode;
  /** `percent` mode: markup (10 = 10% above) or markdown (-5 = 5% below). */
  percent?: number;
  /** `rates` mode: one rate per item; items not listed use their own price. */
  rates: PriceListRate[];
  /** The list for parties of this side that have none of their own. */
  isDefault: boolean;
  active: boolean;
  version?: number;
}

export type PriceListInput = Omit<PriceList, "id" | "version">;

export const MAX_PRICE_LIST_RATES = 5000;

export type PricedItem = Pick<
  Item,
  "id" | "name" | "code" | "unit" | "altUnit" | "salePrice" | "purchasePrice"
>;

const unitsOf = (item: PricedItem) =>
  `${item.unit}${item.altUnit ? ` or ${item.altUnit.name}` : ""}`;

/** Field problems for a price list; empty when it can be saved. */
export function checkPriceList(
  input: PriceListInput,
  others: Pick<PriceList, "id" | "name">[],
  items: PricedItem[],
  id?: ID,
): Record<string, string> {
  const problems: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) problems.name = "Name the price list.";
  else if (name.length > 60) problems.name = "Use up to 60 characters.";
  else if (
    others.some(
      (l) => l.id !== id && l.name.trim().toLowerCase() === name.toLowerCase(),
    )
  )
    problems.name = "A price list with this name already exists.";
  if (input.mode === "percent") {
    const p = input.percent;
    if (p === undefined || !Number.isFinite(p) || p < -100 || p > 1000)
      problems.percent = "Use a percentage from -100 to 1000.";
    else if (Math.abs(Math.round(p * 1000) - p * 1000) > 1e-6)
      problems.percent = "Use up to 3 decimals.";
    return problems;
  }
  if (input.rates.length > MAX_PRICE_LIST_RATES) {
    problems.rates = `A price list holds up to ${MAX_PRICE_LIST_RATES} items.`;
    return problems;
  }
  const seen = new Set<string>();
  for (const r of input.rates) {
    const item = items.find((i) => i.id === r.itemId);
    if (!item) {
      problems.rates = "One of the items is no longer available.";
      break;
    }
    const unit = r.unit ?? item.unit;
    if (unit !== item.unit && unit !== item.altUnit?.name) {
      problems.rates = `${item.name} is sold in ${unitsOf(item)}, not ${unit}.`;
      break;
    }
    const key = `${r.itemId}:${unit}`;
    if (seen.has(key)) {
      problems.rates = `${item.name} is listed twice.`;
      break;
    }
    seen.add(key);
    if (!Number.isSafeInteger(r.rate) || r.rate < 0) {
      problems.rates = `Enter a rate for ${item.name}.`;
      break;
    }
  }
  return problems;
}

/** The list as saved: trimmed, rates only in `rates` mode, base units left out. */
export function cleanPriceList(
  input: PriceListInput,
  items: PricedItem[],
): PriceListInput {
  return {
    name: input.name.trim(),
    side: input.side,
    mode: input.mode,
    ...(input.mode === "percent" ? { percent: input.percent } : {}),
    rates:
      input.mode === "rates"
        ? input.rates.map((r) => {
            const item = items.find((i) => i.id === r.itemId);
            return r.unit && r.unit !== item?.unit
              ? { itemId: r.itemId, rate: r.rate, unit: r.unit }
              : { itemId: r.itemId, rate: r.rate };
          })
        : [],
    isDefault: input.isDefault,
    active: input.active,
  };
}

/** e.g. "5% below sale price · default" or "12 item rates". */
export function priceListSummary(list: PriceList): string {
  const base = list.side === "sale" ? "sale price" : "purchase price";
  const p = list.percent ?? 0;
  const how =
    list.mode === "percent"
      ? p === 0
        ? `Same as ${base}`
        : `${Math.abs(p)}% ${p > 0 ? "above" : "below"} ${base}`
      : `${list.rates.length} item rate${list.rates.length === 1 ? "" : "s"}`;
  return [
    how,
    list.isDefault ? "default" : "",
    list.active ? "" : "switched off",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const priceListSideOf = (
  partyType: "customer" | "supplier",
): PriceListSide => (partyType === "customer" ? "sale" : "purchase");

/** The list that prices this party's lines: its own, else the firm default for the side. */
export function priceListFor(
  lists: PriceList[] | undefined,
  party: { priceListId?: ID } | undefined,
  side: PriceListSide,
): PriceList | undefined {
  const usable = (lists ?? []).filter((l) => l.active && l.side === side);
  if (party?.priceListId) {
    const own = usable.find((l) => l.id === party.priceListId);
    if (own) return own;
  }
  return usable.find((l) => l.isDefault);
}

/**
 * The list's rate for an item: per base unit, or per `unit` when the list
 * names the item's second unit. undefined = the list has no rate for it.
 */
export function priceListRate(
  list: PriceList | undefined,
  item: PricedItem,
): { rate: Paise; unit?: string } | undefined {
  if (!list) return undefined;
  if (list.mode === "percent") {
    const base = list.side === "sale" ? item.salePrice : item.purchasePrice;
    return {
      rate: Math.max(0, Math.round((base * (100 + (list.percent ?? 0))) / 100)),
    };
  }
  const found =
    list.rates.find((r) => r.itemId === item.id && !r.unit) ??
    list.rates.find((r) => r.itemId === item.id);
  if (!found) return undefined;
  return found.unit && found.unit !== item.unit
    ? { rate: found.rate, unit: found.unit }
    : { rate: found.rate };
}

/** Splits one CSV line, with "quoted, values" and "" for a quote. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"' && line.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Per-item rates from a CSV: item code or name, rate in rupees, and
 * optionally the unit. A first row naming the columns is skipped. Every row
 * is checked; each problem is reported with its line number.
 */
export function parsePriceListCsv(
  text: string,
  items: PricedItem[],
): { rates: PriceListRate[]; errors: string[] } {
  const rates: PriceListRate[] = [];
  const errors: string[] = [];
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(
    /\r?\n/,
  );
  const byCode = new Map(
    items.filter((i) => i.code).map((i) => [i.code.toUpperCase(), i]),
  );
  const byName = new Map<string, PricedItem[]>();
  for (const i of items) {
    const key = i.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), i]);
  }
  const seen = new Map<string, number>();
  lines.forEach((raw, index) => {
    const n = index + 1;
    if (!raw.trim()) return;
    const [ref = "", rateText = "", unitText = ""] = csvCells(raw);
    if (index === 0 && /^(item|code|name|item code|item name)$/i.test(ref))
      return;
    const named = byName.get(ref.toLowerCase()) ?? [];
    const item =
      byCode.get(ref.toUpperCase()) ??
      (named.length === 1 ? named[0] : undefined);
    if (!item) {
      errors.push(
        named.length
          ? `Line ${n}: more than one item is called "${ref}"; use its code.`
          : `Line ${n}: no item with code or name "${ref}".`,
      );
      return;
    }
    const cleaned = rateText.replace(/[₹,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      errors.push(`Line ${n}: "${rateText}" isn't a rate in rupees.`);
      return;
    }
    const unit = unitText && unitText !== item.unit ? unitText : undefined;
    if (unit && unit !== item.altUnit?.name) {
      errors.push(
        `Line ${n}: ${item.name} is sold in ${unitsOf(item)}, not ${unit}.`,
      );
      return;
    }
    const key = `${item.id}:${unit ?? ""}`;
    const earlier = seen.get(key);
    if (earlier) {
      errors.push(`Line ${n}: ${item.name} is already on line ${earlier}.`);
      return;
    }
    seen.set(key, n);
    rates.push({
      itemId: item.id,
      rate: Math.round(Number(cleaned) * 100),
      ...(unit ? { unit } : {}),
    });
  });
  if (rates.length > MAX_PRICE_LIST_RATES)
    errors.push(`A price list holds up to ${MAX_PRICE_LIST_RATES} items.`);
  return { rates, errors };
}

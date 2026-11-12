import type { TradeRate } from "@repo/core";

/** "party": a party's products. "item": a product's suppliers or customers. */
export type TradeView = "party" | "item";
export type TradeSort = "recent" | "name" | "rate-low" | "rate-high" | "qty";
export type TradePeriod = "all" | "30" | "90" | "365";

export interface TradeFilters {
  search: string;
  sort: TradeSort;
  period: TradePeriod;
  group: string | null;
  inStock: boolean;
}

export const NO_TRADE_FILTERS: TradeFilters = {
  search: "",
  sort: "recent",
  period: "all",
  group: null,
  inStock: false,
};

export const TRADE_SORTS: { key: TradeSort; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "name", label: "Name" },
  { key: "rate-low", label: "Rate: low to high" },
  { key: "rate-high", label: "Rate: high to low" },
  { key: "qty", label: "Quantity" },
];

export const TRADE_PERIODS: { key: TradePeriod; label: string }[] = [
  { key: "all", label: "Any time" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "365", label: "Last year" },
];

const daysBefore = (today: string, days: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** The rows to show, filtered and sorted. */
export function filterTradeRates(
  rows: TradeRate[],
  filters: TradeFilters,
  view: TradeView,
  today: string,
): TradeRate[] {
  const q = filters.search.trim().toLowerCase();
  const since =
    filters.period === "all" ? null : daysBefore(today, Number(filters.period));
  const name = (r: TradeRate) => (view === "party" ? r.itemName : r.partyName);
  const visible = rows.filter(
    (r) =>
      (!q ||
        (view === "party"
          ? `${r.itemName} ${r.itemCode} ${r.group}`
          : r.partyName
        )
          .toLowerCase()
          .includes(q)) &&
      (!since || r.lastDate >= since) &&
      (!filters.group || r.group === filters.group) &&
      (!filters.inStock || (r.stockQty ?? 0) > 0),
  );
  const order: Record<TradeSort, (a: TradeRate, b: TradeRate) => number> = {
    recent: (a, b) => b.lastDate.localeCompare(a.lastDate),
    name: (a, b) => name(a).localeCompare(name(b)),
    "rate-low": (a, b) => a.rate - b.rate,
    "rate-high": (a, b) => b.rate - a.rate,
    qty: (a, b) => b.qty - a.qty,
  };
  return [...visible].sort(
    (a, b) => order[filters.sort](a, b) || name(a).localeCompare(name(b)),
  );
}

/** Groups present in the rows, for the group chips. */
export const tradeGroups = (rows: TradeRate[]) =>
  [...new Set(rows.map((r) => r.group).filter(Boolean))].sort();

/** "▲ 4.2%" when the latest rate rose against the bill before; null when unchanged or new. */
export function rateChange(row: Pick<TradeRate, "rate" | "previousRate">) {
  if (row.previousRate === null || row.previousRate === 0) return null;
  const change = ((row.rate - row.previousRate) / row.previousRate) * 100;
  if (Math.abs(change) < 0.05) return null;
  return {
    up: change > 0,
    text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`,
  };
}

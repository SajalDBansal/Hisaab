/**
 * Report calculations: sales/purchase summaries, expenses, outstanding and stock.
 * Pure functions — the services pass in the data, the screens only display results.
 */
import { monthLabel, yearMonth } from "../dates";
import type {
  ISODate,
  Item,
  Paise,
  Party,
  PartyType,
  TaxScope,
  Voucher,
} from "../types";
import { lineInScope } from "./taxType";
import {
  ageing,
  isPosted,
  overdueSummary,
  partyBalance,
  collectionBills,
  type Ageing,
} from "./bills";
import { calcInvoice, calcLine } from "./invoice";
import { voucherPostings } from "./postings";
import { baseQty, formatQty, isLowStock } from "./stock";
import { stockLots } from "./stockLots";
import { bookScopeOf } from "./bookScope";
import type { CustomAccount } from "./accounts";

const inRange = (v: Voucher, from: ISODate, to: ISODate) =>
  isPosted(v) && v.date >= from && v.date <= to;

/** Months from `from` to `to`, oldest first: ["2026-08", "2026-09", "2026-10"]. */
export function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const end = yearMonth(to);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sales / purchase summary
// ---------------------------------------------------------------------------

export interface TradeSummary {
  count: number;
  taxable: Paise;
  tax: Paise;
  /** Invoice totals including tax. */
  total: Paise;
  /** Returns in the same period (credit notes for sales, debit notes for purchases), including tax. */
  returns: { count: number; total: Paise };
  byMonth: { month: string; label: string; total: Paise }[];
  /** Biggest first. */
  byParty: { partyId: string; name: string; count: number; total: Paise }[];
  /** By taxable value, biggest first. */
  byItem: {
    itemId: string;
    name: string;
    /** Base units. */
    qty: number;
    unit: string;
    /** e.g. "96 Nos · 8 Box" */
    qtyLabel: string;
    taxable: Paise;
  }[];
}

export function tradeSummary(
  kind: "sale" | "purchase",
  vouchers: Voucher[],
  parties: Party[],
  items: Item[],
  from: ISODate,
  to: ISODate,
  /** All bills, only the GST part of them, or only the nil / exempt / non-GST part. */
  scope: TaxScope = "all",
): TradeSummary {
  if (scope !== "all")
    return tradeSummary(
      kind,
      vouchers.filter((v) => bookScopeOf(v) === scope),
      parties,
      items,
      from,
      to,
    );
  const list = vouchers.filter((v) => v.type === kind && inRange(v, from, to));
  let count = 0;
  const months = new Map(monthsBetween(from, to).map((m) => [m, 0]));
  const byParty = new Map<string, TradeSummary["byParty"][number]>();
  const byItem = new Map<string, TradeSummary["byItem"][number]>();
  let taxable = 0;
  let tax = 0;
  let total = 0;

  for (const v of list) {
    const t = calcInvoice({
      lines: v.lines ?? [],
      charges: v.charges,
      interState: !!v.interState,
    });
    const part = { taxable: t.taxable, tax: t.tax, total: v.amount };
    if (!v.lines?.length) continue;
    count++;
    taxable += part.taxable;
    tax += part.tax;
    total += part.total;
    const m = yearMonth(v.date);
    months.set(m, (months.get(m) ?? 0) + part.total);

    const pid = v.partyId ?? "";
    const p = byParty.get(pid) ?? {
      partyId: pid,
      name: parties.find((x) => x.id === pid)?.name ?? "Unknown party",
      count: 0,
      total: 0,
    };
    p.count++;
    p.total += part.total;
    byParty.set(pid, p);

    for (const line of v.lines ?? []) {
      if (!lineInScope(line, scope)) continue;
      const item = items.find((i) => i.id === line.itemId);
      const row = byItem.get(line.itemId) ?? {
        itemId: line.itemId,
        name: item?.name ?? "Unknown item",
        qty: 0,
        unit: item?.unit ?? "",
        qtyLabel: "",
        taxable: 0,
      };
      row.qty += baseQty(line);
      row.taxable += calcLine(line, !!v.interState).taxable;
      byItem.set(line.itemId, row);
    }
  }

  // Returns in the period, counted the same way (the part in the filter)
  const noteType = kind === "sale" ? "credit-note" : "debit-note";
  const returns = { count: 0, total: 0 };
  for (const v of vouchers) {
    if (v.type !== noteType || !inRange(v, from, to)) continue;
    const lines = (v.lines ?? []).filter((l) => lineInScope(l, scope));
    if (!lines.length) continue;
    returns.count++;
    returns.total += calcInvoice({
      lines,
      interState: !!v.interState,
    }).grandTotal;
  }

  return {
    count,
    taxable,
    tax,
    total,
    returns,
    byMonth: [...months.entries()].map(([month, t]) => ({
      month,
      label: monthLabel(month),
      total: t,
    })),
    byParty: [...byParty.values()].sort((a, b) => b.total - a.total),
    byItem: [...byItem.values()]
      .map((r) => {
        const item = items.find((i) => i.id === r.itemId);
        return { ...r, qtyLabel: item ? formatQty(item, r.qty) : `${r.qty}` };
      })
      .sort((a, b) => b.taxable - a.taxable),
  };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseSummary {
  total: Paise;
  /** Biggest first. `entries` counts the vouchers that touched the head. */
  heads: { head: string; entries: number; total: Paise }[];
}

/**
 * Every expense account in the period, from expense vouchers, journals
 * (salary, depreciation) and purchase freight — the same figures as the P&L.
 */
export function expenseSummary(
  vouchers: Voucher[],
  from: ISODate,
  to: ISODate,
  accounts: CustomAccount[] = [],
): ExpenseSummary {
  const heads = new Map<string, ExpenseSummary["heads"][number]>();
  for (const v of vouchers) {
    if (!inRange(v, from, to)) continue;
    for (const p of voucherPostings(v)) {
      const custom = accounts.find((a) => `account:${a.id}` === p.account);
      const isExpense =
        custom &&
        ["Direct Expenses", "Indirect Expenses"].includes(custom.group);
      if (!p.account.startsWith("expense:") && !isExpense) continue;
      const head = custom?.name ?? p.account.slice("expense:".length);
      const row = heads.get(head) ?? { head, entries: 0, total: 0 };
      row.entries++;
      row.total += p.debit - p.credit;
      heads.set(head, row);
    }
  }
  const list = [...heads.values()]
    .filter((h) => h.total !== 0)
    .sort((a, b) => b.total - a.total);
  return { total: list.reduce((s, h) => s + h.total, 0), heads: list };
}

// ---------------------------------------------------------------------------
// Outstanding (receivables / payables)
// ---------------------------------------------------------------------------

export interface OutstandingRow {
  partyId: string;
  name: string;
  city: string;
  /** Always positive: what they owe us (customers) or we owe them (suppliers). */
  amount: Paise;
  ageing: Ageing;
  overdue: Paise;
  maxOverdueDays: number;
  /** Payments not yet matched to a bill (open bills − amount). */
  onAccount: Paise;
}

export interface Outstanding {
  type: PartyType;
  total: Paise;
  overdue: Paise;
  ageing: Ageing;
  /** Unmatched payments; ageing total − onAccount = total. */
  onAccount: Paise;
  /** Biggest first. Parties with nothing outstanding are left out. */
  rows: OutstandingRow[];
}

export function outstanding(
  type: PartyType,
  parties: Party[],
  vouchers: Voucher[],
  asOf: ISODate,
): Outstanding {
  const sign = type === "customer" ? 1 : -1;
  const total: Ageing = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const rows: OutstandingRow[] = [];
  for (const party of parties.filter((p) => p.type === type)) {
    const amount = partyBalance(party, vouchers, asOf) * sign;
    if (amount <= 0) continue;
    const bills = collectionBills(party, vouchers, asOf);
    const a = ageing(bills);
    const s = overdueSummary(bills);
    (Object.keys(total) as (keyof Ageing)[]).forEach((k) => (total[k] += a[k]));
    rows.push({
      partyId: party.id,
      name: party.name,
      city: party.city,
      amount,
      ageing: a,
      overdue: s.overdueAmount,
      maxOverdueDays: s.maxOverdueDays,
      onAccount: Object.values(a).reduce((t, n) => t + n, 0) - amount,
    });
  }
  rows.sort((a, b) => b.amount - a.amount);
  return {
    type,
    total: rows.reduce((s, r) => s + r.amount, 0),
    overdue: rows.reduce((s, r) => s + r.overdue, 0),
    ageing: total,
    onAccount: rows.reduce((s, r) => s + r.onAccount, 0),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Stock summary
// ---------------------------------------------------------------------------

export interface StockSummary {
  totalValue: Paise;
  itemCount: number;
  lowCount: number;
  groups: {
    group: string;
    value: Paise;
    items: {
      itemId: string;
      name: string;
      qty: number;
      unit: string;
      /** e.g. "60 Nos · 5 Box" */
      qtyLabel: string;
      value: Paise;
      low: boolean;
    }[];
  }[];
}

/** Closing stock by item group, using the cost and category of each remaining lot. */
export function stockSummary(
  items: Item[],
  vouchers: Voucher[],
  scope: TaxScope = "all",
): StockSummary {
  const groups = new Map<string, StockSummary["groups"][number]>();
  let lowCount = 0;
  const shown = items.filter(
    (i) =>
      scope === "all" ||
      stockLots(i, vouchers).some((l) => l.bookScope === scope && l.qty !== 0),
  );
  for (const item of shown) {
    const lots = stockLots(item, vouchers).filter(
      (l) => scope === "all" || l.bookScope === scope,
    );
    const qty =
      Math.round(lots.reduce((sum, l) => sum + l.qty, 0) * 1000) / 1000;
    const value = lots.reduce((sum, l) => sum + l.value, 0);
    const low = isLowStock(item, qty);
    if (low) lowCount++;
    const g = groups.get(item.group) ?? {
      group: item.group,
      value: 0,
      items: [],
    };
    g.value += value;
    g.items.push({
      itemId: item.id,
      name: item.name,
      qty,
      unit: item.unit,
      qtyLabel: formatQty(item, qty),
      value,
      low,
    });
    groups.set(item.group, g);
  }
  const list = [...groups.values()].sort((a, b) => b.value - a.value);
  list.forEach((g) => g.items.sort((a, b) => b.value - a.value));
  return {
    totalValue: list.reduce((s, g) => s + g.value, 0),
    itemCount: shown.length,
    lowCount,
    groups: list,
  };
}

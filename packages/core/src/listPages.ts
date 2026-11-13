// The filters, sort orders and totals behind each paged list screen. The API
// and the demo books both call these, so a list reads the same either way.
// Totals cover every matching row, not just the page on screen.

import type {
  BookScope,
  Item,
  Party,
  TaxScope,
  Voucher,
  VoucherType,
} from "./types";
import type { InvoiceStatus } from "./accounting/bills";
import type { OrderStatus } from "./accounting/orders";
import { scopeVouchers } from "./accounting/bookScope";
import { voucherInScope } from "./accounting/taxType";
import { newestFirst } from "./accounting/reports";
import type { StockLot } from "./accounting/stockLots";
import { isLowStock } from "./accounting/stock";
import { matchesSearch, pageRows, type Page, type PageQuery } from "./paging";

export type PagedList<T, S> = Page<T> & { summary: S };

/** Every voucher type; the demo books can read them all. */
export const VOUCHER_TYPES: readonly VoucherType[] = [
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "credit-note",
  "debit-note",
  "contra",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
];

const yearMonth = (date: string) => date.slice(0, 7);
const byName = (a: string, b: string) =>
  a.localeCompare(b, "en", { sensitivity: "base" });

// ---- Parties ---------------------------------------------------------------

export interface PartyPageQuery extends PageQuery {
  search?: string;
  overdue?: boolean;
  withBalance?: boolean;
  sort?: "balance" | "name";
}
export interface PartyPageSummary {
  /** Owed to us, over every party of the chosen type. */
  receivable: number;
  /** Owed by us. */
  payable: number;
}
type PartyView = {
  id: string;
  name: string;
  phone: string;
  gstin?: string;
  balance: number;
  overdueAmount: number;
};

/** `view` reads the fields each list row shape keeps in its own place. */
export function partyPage<T>(
  rows: T[],
  query: PartyPageQuery,
  view: (row: T) => PartyView,
): PagedList<T, PartyPageSummary> {
  const viewed = rows.map((row) => ({ row, v: view(row) }));
  const summary = { receivable: 0, payable: 0 };
  for (const { v } of viewed) {
    if (v.balance > 0) summary.receivable += v.balance;
    else summary.payable -= v.balance;
  }
  const matching = viewed
    .filter(
      ({ v }) =>
        matchesSearch(query.search, v.name, v.phone, v.gstin) &&
        (!query.overdue || v.overdueAmount > 0) &&
        (!query.withBalance || v.balance !== 0),
    )
    .sort(
      (a, b) =>
        (query.sort === "name"
          ? 0
          : Math.abs(b.v.balance) - Math.abs(a.v.balance)) ||
        byName(a.v.name, b.v.name) ||
        a.v.id.localeCompare(b.v.id),
    )
    .map(({ row }) => row);
  return { ...pageRows(matching, query), summary };
}

// ---- Items -----------------------------------------------------------------

export interface ItemPageQuery extends PageQuery {
  search?: string;
  group?: string;
  low?: boolean;
  scope?: TaxScope;
}
export interface ItemPageRow {
  item: Item;
  /** Stock in the chosen books. */
  qty: number;
  /** Its cost. */
  value: number;
  lowStock: boolean;
}
export interface ItemPageSummary {
  /** Items with stock in the chosen books (every item for "all"). */
  count: number;
  value: number;
  lowCount: number;
  /** Groups among those items, for the filter chips. */
  groups: string[];
}

/** `lots` holds each item's stock lots, in `items` order. */
export function itemPage(
  items: Item[],
  lots: StockLot[][],
  query: ItemPageQuery,
): PagedList<ItemPageRow, ItemPageSummary> {
  const scope = query.scope ?? "all";
  const scoped = items
    .map((item, index) => {
      const held = lots[index].filter(
        (lot) => scope === "all" || lot.bookScope === scope,
      );
      const qty =
        Math.round(held.reduce((sum, lot) => sum + lot.qty, 0) * 1000) / 1000;
      return {
        item,
        qty,
        value: held.reduce((sum, lot) => sum + lot.value, 0),
        lowStock: isLowStock(item, qty),
      };
    })
    .filter((row) => scope === "all" || row.qty !== 0);
  const summary: ItemPageSummary = {
    count: scoped.length,
    value: scoped.reduce((sum, row) => sum + row.value, 0),
    lowCount: scoped.filter((row) => row.lowStock).length,
    groups: [
      ...new Set(scoped.map((row) => row.item.group).filter(Boolean)),
    ].sort(byName),
  };
  const matching = scoped
    .filter(
      (row) =>
        matchesSearch(
          query.search,
          row.item.name,
          row.item.code,
          row.item.hsn,
        ) &&
        (!query.low || row.lowStock) &&
        (!query.group || row.item.group === query.group),
    )
    .sort(
      (a, b) =>
        byName(a.item.name, b.item.name) || a.item.id.localeCompare(b.item.id),
    );
  return { ...pageRows(matching, query), summary };
}

// ---- Sales invoices and purchase bills --------------------------------------

export interface InvoicePageQuery extends PageQuery {
  /** "YYYY-MM", or "all". */
  month?: string;
  status?: InvoiceStatus;
  search?: string;
  scope?: TaxScope;
}
export interface InvoicePageSummary {
  /** Posted bills in the period: billed, received or paid, and still due. */
  amount: number;
  settled: number;
  due: number;
  /** Bills in the period by status, for the status chips. */
  counts: Partial<Record<InvoiceStatus, number>>;
  /** Bills in the period, any status. */
  inPeriod: number;
}
type InvoiceLike = {
  voucher: Voucher;
  partyName: string;
  settled: number;
  pending: number;
  status: InvoiceStatus;
};

/** Rows arrive newest first and keep that order. */
export function invoicePage<T extends InvoiceLike>(
  rows: T[],
  query: InvoicePageQuery,
): PagedList<T, InvoicePageSummary> {
  const month = query.month ?? "all";
  const inPeriod = rows.filter(
    (r) =>
      voucherInScope(r.voucher, query.scope ?? "all") &&
      (month === "all" || yearMonth(r.voucher.date) === month),
  );
  const summary: InvoicePageSummary = {
    amount: 0,
    settled: 0,
    due: 0,
    counts: {},
    inPeriod: inPeriod.length,
  };
  for (const r of inPeriod) {
    summary.counts[r.status] = (summary.counts[r.status] ?? 0) + 1;
    if (r.voucher.status !== "posted") continue;
    summary.amount += r.voucher.amount;
    summary.settled += Math.min(r.settled, r.voucher.amount);
    summary.due += r.pending;
  }
  const matching = inPeriod.filter(
    (r) =>
      (!query.status || r.status === query.status) &&
      matchesSearch(
        query.search,
        r.partyName,
        r.voucher.number,
        r.voucher.supplierInvoiceNo,
      ),
  );
  return { ...pageRows(matching, query), summary };
}

// ---- Estimates, orders and delivery notes ----------------------------------

export interface OrderPageQuery extends PageQuery {
  status?: OrderStatus;
  search?: string;
}
export interface OrderPageSummary {
  /** Value of open documents. */
  openValue: number;
  counts: Partial<Record<OrderStatus, number>>;
  all: number;
}
type OrderLike = { voucher: Voucher; partyName: string; status: OrderStatus };

export function orderPage<T extends OrderLike>(
  rows: T[],
  query: OrderPageQuery,
): PagedList<T, OrderPageSummary> {
  const summary: OrderPageSummary = {
    openValue: 0,
    counts: {},
    all: rows.length,
  };
  for (const r of rows) {
    summary.counts[r.status] = (summary.counts[r.status] ?? 0) + 1;
    if (r.status === "open") summary.openValue += r.voucher.amount;
  }
  const matching = rows.filter(
    (r) =>
      (!query.status || r.status === query.status) &&
      matchesSearch(query.search, r.partyName, r.voucher.number),
  );
  return { ...pageRows(matching, query), summary };
}

// ---- Vouchers: day book, journals, banking, a party's entries ----------------

export interface VoucherPageQuery extends PageQuery {
  /** Comma-separated voucher types; empty for every readable type. */
  types?: string;
  scope?: TaxScope;
  /** A party's own entries, including journals that name the party. */
  partyId?: string;
  /** Banking: money received, or money paid out. */
  direction?: "in" | "out";
  search?: string;
}
export interface VoucherPageSummary {
  /** Sum of the matching entries' amounts. */
  amount: number;
}

/**
 * `readable` are the types the caller's role may see. `defaultScope` is the
 * firm's main book, used to place entries that name no book.
 */
export function voucherPage(
  vouchers: Voucher[],
  query: VoucherPageQuery,
  options: {
    readable: readonly VoucherType[];
    defaultScope: BookScope;
    parties: Party[];
  },
): PagedList<Voucher, VoucherPageSummary> {
  const asked = (query.types ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const types = new Set(
    options.readable.filter((t) => !asked.length || asked.includes(t)),
  );
  const partyAccount = query.partyId ? `party:${query.partyId}` : null;
  const kept = vouchers.filter(
    (v) =>
      v.status !== "draft" &&
      types.has(v.type) &&
      (!partyAccount ||
        v.partyId === query.partyId ||
        !!v.journalLines?.some((l) => l.account === partyAccount)) &&
      (!query.direction ||
        (query.direction === "in"
          ? v.type === "receipt"
          : v.type === "payment" || v.type === "expense")) &&
      matchesSearch(query.search, v.number, v.narration, v.expenseHead),
  );
  const scoped = newestFirst(
    scopeVouchers(
      kept,
      query.scope ?? "all",
      options.defaultScope,
      options.parties,
    ),
  );
  return {
    ...pageRows(scoped, query),
    summary: { amount: scoped.reduce((sum, v) => sum + v.amount, 0) },
  };
}

// ---- Edit log ---------------------------------------------------------------

export type AuditFilter = "all" | "edited" | "cancelled";
export interface AuditPageQuery extends PageQuery {
  filter?: AuditFilter;
}
export interface AuditPageSummary {
  all: number;
  /** Edits and conversions: neither creations nor cancellations. */
  changes: number;
  cancelled: number;
}
const isChange = (action: string) =>
  action !== "created" && action !== "cancelled";

/** Entries arrive newest first. */
export function auditPage<T extends { action: string }>(
  entries: T[],
  query: AuditPageQuery,
): PagedList<T, AuditPageSummary> {
  const summary = {
    all: entries.length,
    changes: entries.filter((e) => isChange(e.action)).length,
    cancelled: entries.filter((e) => e.action === "cancelled").length,
  };
  const filter = query.filter ?? "all";
  const matching = entries.filter((e) =>
    filter === "all"
      ? true
      : filter === "edited"
        ? isChange(e.action)
        : e.action === "cancelled",
  );
  return { ...pageRows(matching, query), summary };
}

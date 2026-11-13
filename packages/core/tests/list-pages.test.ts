import { describe, expect, test } from "bun:test";
import { buildSeed } from "../src/mock/seed";
import {
  auditPage,
  invoicePage,
  itemPage,
  orderPage,
  partyPage,
  voucherPage,
  VOUCHER_TYPES,
} from "../src/listPages";
import {
  cursorOffset,
  laterPageCursors,
  pageRows,
  statementAsPage,
} from "../src/paging";
import { stockLotsFor } from "../src/accounting/stockLots";
import { voucherService } from "../src/services/voucherService";
import { partyService } from "../src/services/partyService";

const rows = Array.from({ length: 65 }, (_, i) => i);

describe("pages", () => {
  test("pages don't overlap, cover every row and say how many there are", () => {
    const first = pageRows(rows);
    expect(first).toMatchObject({ nextCursor: "30", total: 65 });
    const seen = [...first.items];
    for (const cursor of laterPageCursors(first.total))
      seen.push(...pageRows(rows, { cursor }).items);
    expect(seen).toEqual(rows);
    expect(pageRows(rows, { cursor: "60" }).nextCursor).toBeNull();
    expect(laterPageCursors(65)).toEqual(["30", "60"]);
    expect(laterPageCursors(30)).toEqual([]);
  });

  test("bad cursors start at the top; limits stay within bounds", () => {
    expect(cursorOffset("abc")).toBe(0);
    expect(cursorOffset("-5")).toBe(0);
    expect(pageRows(rows, { cursor: "999" }).items).toEqual([]);
    expect(pageRows(rows, { limit: 1000 }).items).toHaveLength(65);
    expect(pageRows(rows, { limit: 0 }).items).toHaveLength(1);
  });

  test("a statement pages its rows and keeps its totals", () => {
    const page = statementAsPage(
      { opening: 5, closing: 9, rows: rows.slice(0, 40) },
      { cursor: "30" },
    );
    expect(page.items).toEqual(rows.slice(30, 40));
    expect(page.summary).toEqual({ opening: 5, closing: 9 });
    expect(page.total).toBe(40);
  });
});

describe("list screens", () => {
  const db = buildSeed();

  test("parties: totals cover the type; filters and sort apply to the rows", async () => {
    const page = await partyService.page({ type: "customer", sort: "balance" });
    const all = await partyService.list("customer");
    expect(page.total).toBe(all.length);
    expect(page.summary.receivable).toBe(
      all.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0),
    );
    const balances = page.items.map((r) => Math.abs(r.balance));
    expect(balances).toEqual([...balances].sort((a, b) => b - a));
    const overdue = await partyService.page({
      type: "customer",
      overdue: true,
    });
    expect(overdue.items.every((r) => r.overdueAmount > 0)).toBe(true);
    // Filters change the rows, never the totals.
    expect(overdue.summary).toEqual(page.summary);
    const first = all[0].party;
    const found = partyPage(all, { search: first.phone }, (r) => ({
      id: r.party.id,
      name: r.party.name,
      phone: r.party.phone,
      balance: r.balance,
      overdueAmount: r.overdueAmount,
    }));
    expect(found.items.map((r) => r.party.id)).toContain(first.id);
  });

  test("items: a book shows only items with stock in it", () => {
    const lots = stockLotsFor(db.items, db.vouchers);
    const all = itemPage(db.items, lots, { scope: "all" });
    expect(all.total).toBe(db.items.length);
    const gst = itemPage(db.items, lots, { scope: "gst" });
    expect(gst.items.every((r) => r.qty !== 0)).toBe(true);
    expect(gst.summary.count).toBe(gst.total);
    const low = itemPage(db.items, lots, { low: true });
    expect(low.total).toBe(all.summary.lowCount);
    expect(all.summary.groups.length).toBeGreaterThan(1);
  });

  test("invoices: period totals and status counts; search narrows rows only", async () => {
    const invoices = await voucherService.listInvoices("sale");
    const all = invoicePage(invoices, { month: "all" });
    expect(all.total).toBe(invoices.length);
    expect(
      Object.values(all.summary.counts).reduce((s, n) => s + (n ?? 0), 0),
    ).toBe(all.summary.inPeriod);
    const target = invoices[0];
    const search = invoicePage(invoices, {
      month: "all",
      search: target.voucher.number,
    });
    expect(search.items.map((r) => r.voucher.id)).toContain(target.voucher.id);
    expect(search.summary).toEqual(all.summary);
    const month = target.voucher.date.slice(0, 7);
    const inMonth = invoicePage(invoices, { month });
    expect(inMonth.items.every((r) => r.voucher.date.startsWith(month))).toBe(
      true,
    );
  });

  test("orders: counts by status and open value", async () => {
    const orders = await voucherService.listOrders("estimate");
    const page = orderPage(orders, { status: "open" });
    expect(page.items.every((r) => r.status === "open")).toBe(true);
    expect(page.summary.all).toBe(orders.length);
    expect(page.summary.openValue).toBe(
      orders
        .filter((r) => r.status === "open")
        .reduce((s, r) => s + r.voucher.amount, 0),
    );
  });

  test("vouchers: newest first, by type, direction and party", () => {
    const options = {
      readable: VOUCHER_TYPES,
      defaultScope: "gst" as const,
      parties: db.parties,
    };
    const all = voucherPage(db.vouchers, { limit: 200 }, options);
    const dates = all.items.map((v) => v.date);
    expect(dates).toEqual([...dates].sort().reverse());
    const moneyIn = voucherPage(
      db.vouchers,
      { types: "receipt,payment,expense,contra", direction: "in" },
      options,
    );
    expect(moneyIn.items.every((v) => v.type === "receipt")).toBe(true);
    const party = db.parties[0];
    const own = voucherPage(
      db.vouchers,
      { partyId: party.id, limit: 200 },
      options,
    );
    expect(
      own.items.every(
        (v) =>
          v.partyId === party.id ||
          v.journalLines?.some((l) => l.account === `party:${party.id}`),
      ),
    ).toBe(true);
    // A role reads only its own types.
    const sales = voucherPage(
      db.vouchers,
      { limit: 200 },
      {
        ...options,
        readable: ["sale", "receipt"],
      },
    );
    expect(sales.items.every((v) => ["sale", "receipt"].includes(v.type))).toBe(
      true,
    );
  });

  test("edit log: a count per filter", () => {
    const entries = [
      { action: "created" },
      { action: "edited" },
      { action: "cancelled" },
      { action: "converted" },
    ];
    const page = auditPage(entries, { filter: "edited" });
    expect(page.summary).toEqual({ all: 4, changes: 2, cancelled: 1 });
    expect(page.items.map((e) => e.action)).toEqual(["edited", "converted"]);
  });
});

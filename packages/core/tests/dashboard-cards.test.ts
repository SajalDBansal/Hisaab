import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createOrder,
  createPayment,
  createPurchase,
  createSale,
  createNote,
} from "../src/mock/db";
import { buildReport, type ReportRequest } from "../src/reporting";
import { computeDashboard } from "../src/accounting/reports";
import { outstanding } from "../src/accounting/analysis";
import {
  DASHBOARD_CARD_IDS,
  availableDashboardCards,
  moveDashboardCard,
  resolveDashboardLayout,
  saveDashboardLayout,
  setDashboardCardVisible,
} from "../src/dashboardLayout";

const AS_OF = "2026-10-26";
const party = (id: string, type: Party["type"]): Party => ({
  id,
  name: id,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 30,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  ...(type === "supplier" ? { gstin: "09BBBBB1111B1ZL" } : {}),
});

function books(gstRegistration: "regular" | "none" = "regular") {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration,
      gstin: gstRegistration === "regular" ? "09AAAAA0000A1Z0" : undefined,
    },
    AS_OF,
  );
  db.parties = [
    party("Asha", "customer"),
    party("Bina", "customer"),
    party("Chand", "customer"),
    party("Supplier A", "supplier"),
    party("Supplier B", "supplier"),
  ];
  db.items = [
    {
      id: "rice",
      name: "Rice",
      code: "",
      hsn: "1006",
      group: "",
      taxType: "taxable",
      gstRate: 5,
      unit: "Kg",
      purchasePrice: 4000,
      salePrice: 5000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  return db;
}
const line = (qty: number, rate: number): InvoiceLine => ({
  itemId: "rice",
  qty,
  rate,
  gstRate: 5,
});
const dashboard = (db: ReturnType<typeof books>, costs?: boolean) =>
  computeDashboard({ ...db, asOf: AS_OF, firm: db.firm, costs });
const report = (
  db: ReturnType<typeof books>,
  id: ReportRequest["report"],
  from = "2026-04-01",
) =>
  buildReport(db, {
    report: id,
    from,
    to: AS_OF,
    includeNarration: false,
    includeZeroBalances: false,
  });

function sampleBooks(gst: "regular" | "none" = "regular") {
  const db = books(gst);
  const old = createPurchase(db, {
    date: "2026-04-02",
    partyId: "Supplier A",
    lines: [line(100, 4000)],
  }); // 207 days: reverse now
  createPayment(db, {
    date: "2026-05-01",
    partyId: "Supplier A",
    amount: old.amount / 2,
    mode: "cash",
    ledgerId: "cash",
    allocations: [{ voucherId: old.id, amount: old.amount / 2 }],
  });
  createPurchase(db, {
    date: "2026-05-20",
    partyId: "Supplier B",
    lines: [line(10, 4000)],
  }); // 159 days: due soon
  createPurchase(db, {
    date: "2026-10-01",
    partyId: "Supplier B",
    lines: [line(20, 4000)],
    dueDate: "2026-10-30",
  }); // due within the week
  createSale(db, {
    date: "2026-05-01",
    partyId: "Bina",
    lines: [line(50, 5000)],
  }); // Bina only bought long ago: gone quiet
  createSale(db, {
    date: "2026-10-05",
    partyId: "Asha",
    lines: [line(10, 5000)],
  });
  const chand = createSale(db, {
    date: "2026-10-10",
    partyId: "Chand",
    lines: [line(30, 5000)],
  });
  createNote(db, "credit-note", {
    againstId: chand.id,
    date: "2026-10-12",
    reason: "Damaged",
    lines: [{ index: 0, qty: 25 }],
  });
  createOrder(db, "estimate", {
    date: "2026-10-20",
    partyId: "Asha",
    lines: [line(5, 5000)],
  });
  createOrder(db, "purchase-order", {
    date: "2026-10-21",
    partyId: "Supplier A",
    lines: [line(5, 4000)],
  });
  return db;
}

describe("dashboard cards (T63)", () => {
  test("ITC at risk matches the ITC at risk report (T26)", () => {
    const db = sampleBooks();
    const d = dashboard(db);
    const rows = report(db, "itc-at-risk")
      .sections[0].rows.filter((r) => !r.total)
      .map((r) => r.cells);
    expect(d.itcAtRisk).not.toBeNull();
    expect(d.itcAtRisk!.bills).toBe(rows.length);
    expect(d.itcAtRisk!.bills).toBe(2);
    expect(d.itcAtRisk!.amount).toBe(
      rows.reduce((s, r) => s + Number(r[10]), 0),
    );
    const reverse = rows.filter((r) => r[0] === "Reverse now");
    expect(d.itcAtRisk!.reverseNowBills).toBe(1);
    expect(d.itcAtRisk!.reverseNow).toBe(Number(reverse[0][10]));
    // The due-soon bill of 20 May reaches 180 days on 16 Nov
    expect(d.itcAtRisk!.nextLimit).toBe("2026-11-16");
    expect(d.itcAtRisk!.topSupplier?.partyId).toBe("Supplier A");
  });

  test("no ITC card for firms without regular GST", () => {
    expect(dashboard(sampleBooks("none")).itcAtRisk).toBeNull();
  });

  test("top parties, quiet customers, open orders, payables and ageing", () => {
    const db = sampleBooks();
    const d = dashboard(db);
    // This month: Asha 10 kg beats Chand 30 kg less 25 returned
    expect(d.topCustomers.map((r) => r.partyId)).toEqual(["Asha", "Chand"]);
    const top = report(db, "top-customers", "2026-10-01")
      .sections[0].rows.filter((r) => !r.total)
      .map((r) => r.cells);
    expect(d.topCustomers.map((r) => r.value)).toEqual(
      top.map((r) => Number(r[3])),
    );
    expect(d.topSuppliers.map((r) => r.partyId)).toEqual(["Supplier B"]);

    expect(d.quietCustomers.count).toBe(1);
    expect(d.quietCustomers.rows[0]).toMatchObject({
      partyId: "Bina",
      lastSale: "2026-05-01",
      daysSince: 178,
    });
    expect(d.quietCustomers.rows[0].balance).toBeGreaterThan(0);

    const open = Object.fromEntries(d.openOrders.map((o) => [o.type, o.count]));
    expect(open).toMatchObject({ estimate: 1, "purchase-order": 1 });
    expect(open["sales-order"]).toBe(0);

    expect(d.payablesDue.thisWeekBills).toBe(1);
    expect(d.payablesDue.overdueBills).toBe(2);
    expect(d.payablesDue.thisWeek + d.payablesDue.overdue).toBe(d.toPay);

    const receivables = outstanding("customer", db.parties, db.vouchers, AS_OF);
    expect(d.receivablesAgeing).toEqual(receivables.ageing);
  });

  test("stock value is left out for roles that may not see costs", () => {
    const db = sampleBooks();
    expect(dashboard(db).stockValue).toBeGreaterThan(0);
    expect(dashboard(db, false).stockValue).toBe(0);
  });
});

describe("dashboard layout (T63)", () => {
  test("defaults: every card in order, new cards partly hidden", () => {
    const slots = resolveDashboardLayout(null);
    expect(slots.map((s) => s.id)).toEqual([...DASHBOARD_CARD_IDS]);
    expect(slots.find((s) => s.id === "itc-at-risk")?.visible).toBe(true);
    expect(slots.find((s) => s.id === "quiet-customers")?.visible).toBe(false);
  });

  test("saved order and hidden cards survive; unknown ids drop; new cards take their default place", () => {
    let slots = resolveDashboardLayout(null);
    slots = moveDashboardCard(slots, "recent", -1);
    slots = setDashboardCardVisible(slots, "cash-chart", false);
    const saved = saveDashboardLayout(slots);
    // A card the saved layout doesn't know yet, and one that no longer exists
    saved.order = saved.order.filter((id) => id !== "stock-value");
    saved.order.push("retired-card");
    const back = resolveDashboardLayout(saved);
    const ids = back.map((s) => s.id);
    expect(ids).not.toContain("retired-card" as never);
    expect(ids.indexOf("recent")).toBe(ids.indexOf("overdue") - 1);
    expect(back.find((s) => s.id === "cash-chart")?.visible).toBe(false);
    expect(ids.indexOf("stock-value")).toBe(ids.indexOf("itc-at-risk") + 1);
    expect(back.find((s) => s.id === "stock-value")?.visible).toBe(true);
  });

  test("moving past either end changes nothing", () => {
    const slots = resolveDashboardLayout(null);
    expect(moveDashboardCard(slots, "balances", -1)).toEqual(slots);
    expect(moveDashboardCard(slots, "upcoming", 1)).toEqual(slots);
  });

  test("roles: no stock value without cost rights, no quick actions without sales", () => {
    expect(availableDashboardCards("owner")).toContain("stock-value");
    expect(availableDashboardCards("viewer")).not.toContain("actions");
    expect(availableDashboardCards("viewer")).toContain("stock-value");
    expect(availableDashboardCards("sales")).not.toContain("stock-value");
    const slots = resolveDashboardLayout(
      saveDashboardLayout(resolveDashboardLayout(null)),
      availableDashboardCards("viewer"),
    );
    expect(slots.map((s) => s.id)).not.toContain("actions");
  });
});

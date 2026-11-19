import { describe, expect, test } from "bun:test";
import type { Item, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createItem,
  createNote,
  createPurchase,
  createSales,
  updateInvoice,
  updateItem,
} from "../src/mock/db";
import { expiringLots, stockLots } from "../src/accounting/stockLots";
import { stockQty, isLowStock, isOverStock } from "../src/accounting/stock";
import { stockShortfallText } from "../src/accounting/stockPolicy";
import { stockSummary } from "../src/accounting/analysis";
import { itemPage } from "../src/listPages";
import { stockLotsFor } from "../src/accounting/stockLots";
import { checkItem } from "../src/validation";
import { buildReport, type ReportRequest } from "../src/reporting";

const party = (type: Party["type"]): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  ...(type === "supplier" ? { gstin: "09BBBBB1111B1ZL" } : {}),
});

const goods = (over: Partial<Item> = {}): Item => ({
  id: "goods",
  name: "Goods",
  code: "G",
  hsn: "1001",
  group: "Staples",
  taxType: "taxable",
  gstRate: 18,
  unit: "Nos",
  purchasePrice: 10000,
  salePrice: 20000,
  mrp: 0,
  reorderLevel: 0,
  openingStock: 0,
  ...over,
});

function books() {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  db.parties = [party("customer"), party("supplier")];
  db.items = [
    goods(),
    goods({
      id: "repair",
      name: "Repair service",
      code: "R",
      hsn: "998719",
      group: "Services",
      kind: "service",
    }),
  ];
  return db;
}

const sale = (
  db: ReturnType<typeof books>,
  lines: { itemId: string; qty: number }[],
  date = "2026-10-10",
) =>
  createSales(db, {
    date,
    partyId: "customer",
    lines: lines.map((l) => ({ ...l, rate: 20000, gstRate: 18 as const })),
  });

const request = (
  report: ReportRequest["report"],
  extra: Partial<ReportRequest> = {},
): ReportRequest => ({
  report,
  from: "2026-04-01",
  to: "2026-10-26",
  includeNarration: false,
  includeZeroBalances: false,
  ...extra,
});

describe("service items (T39)", () => {
  test("a service sells without stock, takes no lot and moves no stock", () => {
    const db = books();
    const [bill] = sale(db, [{ itemId: "repair", qty: 2 }]);
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines![0].stockLotId).toBeUndefined();
    expect(bill.lines![0].stockCost).toBeUndefined();
    expect(bill.lines![0].bookScope).toBe("gst");
    const service = db.items[1];
    expect(stockQty(service, db.vouchers)).toBe(0);
    expect(stockLots(service, db.vouchers)).toEqual([]);
    expect(isLowStock({ ...service, reorderLevel: 5 }, 0)).toBe(false);
  });

  test("a sale mixing goods and a service uses FIFO for the goods only", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "supplier",
      lines: [
        { itemId: "goods", qty: 5, rate: 10000, gstRate: 18 },
        { itemId: "repair", qty: 1, rate: 5000, gstRate: 18 },
      ],
    });
    // The service purchase made no lot
    expect(stockLots(db.items[1], db.vouchers)).toEqual([]);
    const [bill] = sale(db, [
      { itemId: "goods", qty: 2 },
      { itemId: "repair", qty: 1 },
    ]);
    expect(bill.lines!.map((l) => !!l.stockLotId)).toEqual([true, false]);
    expect(stockQty(db.items[0], db.vouchers)).toBe(3);
    // Goods without stock are still refused (no negative stock under FIFO)
    expect(() => sale(db, [{ itemId: "goods", qty: 9 }])).toThrow(
      /Only 3 units/,
    );
  });

  test("a service's sale return and edit keep it stock-free", () => {
    const db = books();
    const [bill] = sale(db, [{ itemId: "repair", qty: 2 }]);
    const note = createNote(db, "credit-note", {
      againstId: bill.id,
      date: "2026-10-11",
      reason: "Returned",
      lines: [{ index: 0, qty: 1 }],
    });
    expect(note.lines![0].stockLotId).toBeUndefined();
    const bought = createPurchase(db, {
      date: "2026-10-05",
      partyId: "supplier",
      lines: [{ itemId: "repair", qty: 2, rate: 5000, gstRate: 18 }],
    });
    expect(bought.lines![0].stockLotId).toBeUndefined();
    const debit = createNote(db, "debit-note", {
      againstId: bought.id,
      date: "2026-10-12",
      reason: "Not done",
      lines: [{ index: 0, qty: 1 }],
    });
    expect(debit.lines![0].stockLotId).toBeUndefined();
    const [other] = sale(db, [{ itemId: "repair", qty: 2 }]);
    updateInvoice(db, other.id, {
      partyId: "customer",
      date: "2026-10-10",
      lines: [{ itemId: "repair", qty: 3, rate: 20000, gstRate: 18 }],
    });
    expect(stockLots(db.items[1], db.vouchers)).toEqual([]);
    expect(stockQty(db.items[1], db.vouchers)).toBe(0);
  });

  test("services are left out of stock reports and keep their kind once used", () => {
    const db = books();
    sale(db, [{ itemId: "repair", qty: 1 }]);
    expect(
      stockSummary(db.items, db.vouchers).groups.flatMap((g) =>
        g.items.map((i) => i.itemId),
      ),
    ).toEqual(["goods"]);
    expect(() =>
      updateItem(db, "repair", { ...db.items[1], kind: "goods" }),
    ).toThrow(/goods and service/);
  });

  test("service validation: SAC starts with 99, no stock or levels", () => {
    const base = goods({ kind: "service", hsn: "1001" });
    expect(checkItem(base, []).hsn).toMatch(/99/);
    expect(
      checkItem({ ...base, hsn: "998719", openingStock: 5 }, []).openingStock,
    ).toBeTruthy();
    expect(
      checkItem({ ...base, hsn: "998719", reorderLevel: 2 }, []).reorderLevel,
    ).toBeTruthy();
    expect(checkItem({ ...base, hsn: "998719" }, [])).toEqual({});
  });
});

describe("minimum and maximum stock (T37)", () => {
  test("low and over stock, list filters and the stock levels report", () => {
    const db = books();
    db.items[0] = goods({ reorderLevel: 5, maxStock: 8 });
    db.items.push(
      goods({ id: "b", name: "B", code: "B", reorderLevel: 2, tags: ["Fast"] }),
    );
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "supplier",
      lines: [
        { itemId: "goods", qty: 10, rate: 10000, gstRate: 18 },
        { itemId: "b", qty: 1, rate: 10000, gstRate: 18 },
      ],
    });
    expect(isOverStock(db.items[0], 10)).toBe(true);
    expect(isOverStock(db.items[0], 8)).toBe(false);
    const page = itemPage(db.items, stockLotsFor(db.items, db.vouchers), {
      over: true,
    });
    expect(page.items.map((r) => r.item.id)).toEqual(["goods"]);
    expect(page.summary.overCount).toBe(1);
    expect(page.summary.lowCount).toBe(1);
    expect(page.summary.tags).toEqual(["Fast"]);
    expect(
      itemPage(db.items, stockLotsFor(db.items, db.vouchers), {
        tag: "fast",
      }).items.map((r) => r.item.id),
    ).toEqual(["b"]);
    expect(
      itemPage(db.items, stockLotsFor(db.items, db.vouchers), {
        kind: "service",
      }).items.map((r) => r.item.id),
    ).toEqual(["repair"]);
    const doc = buildReport(db, request("stock-levels"));
    const cells = doc.sections[0].rows.map((r) => r.cells);
    // Low first (order up to its minimum), then over (excess above the maximum)
    expect(cells).toEqual([
      ["B", "Staples", 1, "Nos", 2, "", "Low", 1, ""],
      ["Goods", "Staples", 10, "Nos", 5, 8, "Over", "", 2],
    ]);
  });

  test("the maximum can't be below the minimum; tags are tidied", () => {
    expect(
      checkItem(goods({ reorderLevel: 5, maxStock: 3 }), []).maxStock,
    ).toBeTruthy();
    const db = books();
    const item = createItem(db, {
      ...goods({ name: "Tagged", code: "T" }),
      tags: [" Fast ", "fast", "", "Diwali"],
    });
    expect(item.tags).toEqual(["Fast", "Diwali"]);
  });

  test("block refuses a new sale below the minimum; warn lets it through", () => {
    const db = books();
    db.items[0] = goods({ reorderLevel: 4 });
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "supplier",
      lines: [{ itemId: "goods", qty: 6, rate: 10000, gstRate: 18 }],
    });
    db.salesControls = {
      overdueSales: "warn",
      stockPolicy: "block",
      version: 1,
    };
    expect(() => sale(db, [{ itemId: "goods", qty: 3 }])).toThrow(
      /below its minimum stock of 4/,
    );
    const [ok] = sale(db, [{ itemId: "goods", qty: 2 }]);
    expect(ok.status).toBe("posted");
    // An edit is not blocked by the minimum
    updateInvoice(db, ok.id, {
      partyId: "customer",
      date: "2026-10-10",
      lines: [{ itemId: "goods", qty: 3, rate: 20000, gstRate: 18 }],
    });
    db.salesControls.stockPolicy = "warn";
    sale(db, [{ itemId: "goods", qty: 1 }]);
    expect(stockQty(db.items[0], db.vouchers)).toBe(2);
  });

  test("the sale form's warning text", () => {
    const item = goods({ reorderLevel: 4 });
    const lots = [{ qty: 6, bookScope: "gst" as const }];
    const line = (qty: number) => ({
      itemId: "goods",
      qty,
      rate: 1,
      gstRate: 18 as const,
    });
    expect(stockShortfallText(item, lots, line(7))).toMatch(/Only 6 Nos/);
    expect(stockShortfallText(item, lots, line(3))).toMatch(
      /below the minimum/,
    );
    expect(stockShortfallText(item, lots, line(3), "block")).toMatch(/refuse/);
    expect(stockShortfallText(item, lots, line(1))).toBeUndefined();
  });
});

describe("batch expiry (T38)", () => {
  test("purchase lines carry batch and expiry to their lots; the report lists expired and expiring", () => {
    const db = books();
    db.items[0] = goods({
      openingStock: 2,
      batch: { number: "OPEN1", expiry: "2026-10-20" },
    });
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "supplier",
      lines: [
        {
          itemId: "goods",
          qty: 5,
          rate: 10000,
          gstRate: 18,
          batchNumber: " B-77 ",
          expiryDate: "2026-11-10",
        },
        {
          itemId: "goods",
          qty: 4,
          rate: 10000,
          gstRate: 18,
          expiryDate: "2027-06-01",
        },
        // A service line keeps no batch
        {
          itemId: "repair",
          qty: 1,
          rate: 100,
          gstRate: 18,
          batchNumber: "X",
          expiryDate: "2026-11-01",
        },
      ],
    });
    const bill = db.vouchers.find((v) => v.type === "purchase")!;
    expect(bill.lines![0].batchNumber).toBe("B-77");
    expect(bill.lines![2].batchNumber).toBeUndefined();
    const lots = stockLots(db.items[0], db.vouchers);
    expect(lots.map((l) => [l.batchNumber, l.expiryDate])).toEqual([
      ["OPEN1", "2026-10-20"],
      ["B-77", "2026-11-10"],
      [undefined, "2027-06-01"],
    ]);
    const rows = expiringLots(db.items, db.vouchers, "2026-10-26", 30);
    expect(rows.map((r) => [r.batchNumber, r.status, r.daysLeft])).toEqual([
      ["OPEN1", "expired", -6],
      ["B-77", "expiring", 15],
    ]);
    // Sold stock leaves the list: FIFO takes the opening lot first
    sale(db, [{ itemId: "goods", qty: 2 }], "2026-10-26");
    expect(
      expiringLots(db.items, db.vouchers, "2026-10-26", 30).map(
        (r) => r.batchNumber,
      ),
    ).toEqual(["B-77"]);
    const doc = buildReport(db, request("expiring-items", { expiryDays: 365 }));
    const cells = doc.sections[0].rows
      .filter((r) => !r.total)
      .map((r) => r.cells);
    expect(cells.map((c) => [c[1], c[3], c[5]])).toEqual([
      ["In 15 days", "B-77", 5],
      ["In 218 days", "", 4],
    ]);
    expect(() =>
      buildReport(db, request("stock-levels", { expiryDays: 3 })),
    ).toThrow(/Only the expiring items report/);
  });
});

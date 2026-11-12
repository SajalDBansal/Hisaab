import { describe, expect, test } from "bun:test";
import type { Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createNote,
  createPurchase,
  createSale,
  createSales,
} from "../src/mock/db";
import {
  openingStockLeft,
  tradeRateHistory,
  tradeRates,
} from "../src/accounting/tradeRates";

const party = (id: string, type: Party["type"]): Party => ({
  id,
  name: id,
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
  db.parties = [
    party("Sharma", "supplier"),
    party("Gupta", "supplier"),
    party("Verma", "customer"),
    party("Khan", "customer"),
  ];
  db.items = [
    {
      id: "cement",
      name: "Cement",
      code: "C1",
      hsn: "2523",
      group: "Building",
      taxType: "taxable",
      gstRate: 28,
      unit: "Bag",
      altUnit: { name: "Pallet", factor: 10 },
      purchasePrice: 30000,
      salePrice: 40000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 5,
      openingCost: 30000,
    },
    {
      id: "sand",
      name: "Sand",
      code: "S1",
      hsn: "2505",
      group: "Aggregates",
      taxType: "taxable",
      gstRate: 5,
      unit: "Ton",
      purchasePrice: 100000,
      salePrice: 130000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  return db;
}

const buy = (
  db: ReturnType<typeof books>,
  partyId: string,
  date: string,
  lines: {
    itemId: string;
    qty: number;
    rate: number;
    discountPercent?: number;
    per?: { unit: string; factor: number };
  }[],
) =>
  createPurchase(db, {
    date,
    partyId,
    lines: lines.map((l) => ({
      gstRate: l.itemId === "cement" ? 28 : 5,
      ...l,
    })),
  });

describe("rates per party and product", () => {
  test("a product from two suppliers: latest rate, rise, and stock left from each (FIFO)", () => {
    const db = books();
    buy(db, "Sharma", "2026-10-01", [
      { itemId: "cement", qty: 10, rate: 34000 },
    ]);
    buy(db, "Gupta", "2026-10-02", [
      { itemId: "cement", qty: 20, rate: 33000 },
    ]);
    // Typed ₹375 with 6% off is ₹352.50 a bag.
    buy(db, "Sharma", "2026-10-05", [
      { itemId: "cement", qty: 10, rate: 37500, discountPercent: 6 },
    ]);
    // FIFO: 5 opening, then Sharma's first 10, then 3 of Gupta's.
    createSales(db, {
      date: "2026-10-06",
      partyId: "Verma",
      lines: [{ itemId: "cement", qty: 18, rate: 40000, gstRate: 28 }],
    });

    const suppliers = tradeRates(db, { type: "supplier", itemId: "cement" });
    const byName = Object.fromEntries(suppliers.map((r) => [r.partyName, r]));
    expect(byName.Sharma).toMatchObject({
      rate: 35250,
      typedRate: 37500,
      previousRate: 34000,
      qty: 20,
      bills: 2,
      lastDate: "2026-10-05",
      firstDate: "2026-10-01",
      stockQty: 10,
    });
    expect(byName.Gupta).toMatchObject({ rate: 33000, qty: 20, stockQty: 17 });
    // Newest bill first.
    expect(suppliers.map((r) => r.partyName)).toEqual(["Sharma", "Gupta"]);
    expect(openingStockLeft(db, "cement")).toEqual({ qty: 0, value: 0 });
  });

  test("a party's products; second-unit bills are per base unit; returns net off", () => {
    const db = books();
    const bill = buy(db, "Gupta", "2026-10-01", [
      {
        itemId: "cement",
        qty: 2,
        rate: 320000,
        per: { unit: "Pallet", factor: 10 },
      },
      { itemId: "sand", qty: 4, rate: 100000 },
    ]);
    createNote(db, "debit-note", {
      againstId: bill.id,
      date: "2026-10-03",
      reason: "Damaged",
      lines: [{ index: 1, qty: 1 }],
    });
    const rows = tradeRates(db, { type: "supplier", partyId: "Gupta" });
    expect(rows.map((r) => [r.itemName, r.rate, r.qty, r.stockQty])).toEqual([
      ["Cement", 32000, 20, 20],
      ["Sand", 100000, 3, 3],
    ]);
    const history = tradeRateHistory(db, db.parties[1], "sand");
    expect(history.map((h) => [h.type, h.qty, h.rate])).toEqual([
      ["debit-note", -1, 100000],
      ["purchase", 4, 100000],
    ]);
  });

  test("customers: latest rate we sold at, without stock; other customers stay apart", () => {
    const db = books();
    buy(db, "Sharma", "2026-10-01", [
      { itemId: "sand", qty: 50, rate: 100000 },
    ]);
    const sale = (partyId: string, date: string, rate: number, qty = 2) =>
      createSale(db, {
        date,
        partyId,
        lines: [{ itemId: "sand", qty, rate, gstRate: 5 }],
      });
    sale("Verma", "2026-10-02", 130000);
    sale("Verma", "2026-10-04", 125000);
    sale("Khan", "2026-10-03", 140000, 5);
    const rows = tradeRates(db, { type: "customer", itemId: "sand" });
    expect(
      rows.map((r) => [r.partyName, r.rate, r.previousRate, r.qty, r.stockQty]),
    ).toEqual([
      ["Verma", 125000, 130000, 4, null],
      ["Khan", 140000, null, 5, null],
    ]);
    expect(tradeRates(db, { type: "customer", partyId: "Khan" })).toHaveLength(
      1,
    );
  });

  test("opening stock still on hand has no supplier", () => {
    const db = books();
    buy(db, "Sharma", "2026-10-01", [
      { itemId: "cement", qty: 10, rate: 34000 },
    ]);
    expect(openingStockLeft(db, "cement")).toEqual({ qty: 5, value: 150000 });
    const [row] = tradeRates(db, { type: "supplier", itemId: "cement" });
    expect(row.stockQty).toBe(10);
  });
});

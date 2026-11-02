import { expect, test } from "bun:test";
import type { Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import { createPurchase, createSale } from "../src/mock/db";
import { finalAccounts } from "../src/accounting/generalLedger";

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
  openingDate: "2026-01-01",
});

test("balance sheet separates earlier periods' profit from the period's", () => {
  const db = blankBooks(
    {
      id: "fixture",
      name: "Fixture",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z5",
    },
    "2026-10-26",
  );
  db.parties = [party("customer"), party("supplier")];
  db.items = [
    {
      id: "item",
      name: "Item",
      code: "",
      hsn: "1001",
      group: "",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: 10000,
      salePrice: 20000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  const purchase = createPurchase(db, {
    date: "2026-03-01",
    partyId: "supplier",
    lines: [{ itemId: "item", qty: 10, rate: 10000, gstRate: 18 }],
  });
  const lot = purchase.lines![0].stockLotId;
  const sell = (date: string, rate: number) =>
    createSale(db, {
      date,
      partyId: "customer",
      lines: [{ itemId: "item", qty: 5, rate, gstRate: 18, stockLotId: lot }],
    });
  sell("2026-03-10", 20000); // FY 2025-26: profit 50,000 paise
  sell("2026-05-10", 30000); // FY 2026-27: profit 1,00,000 paise

  const { balanceSheet, profitAndLoss } = finalAccounts(
    db,
    "2026-10-26",
    "2026-04-01",
  );
  expect(profitAndLoss.netProfit).toBe(100000);
  const capital = balanceSheet.liabilities.sections[0].lines;
  expect(capital).toContainEqual({
    name: "Add: profit of earlier periods",
    amount: 50000,
  });
  expect(capital).toContainEqual({
    name: "Add: net profit for the period",
    amount: 100000,
  });
  expect(balanceSheet.balanced).toBe(true);
  // Without a period the cumulative result stays on one line.
  const all = finalAccounts(db).balanceSheet.liabilities.sections[0].lines;
  expect(all).toContainEqual({ name: "Add: net profit", amount: 150000 });
});

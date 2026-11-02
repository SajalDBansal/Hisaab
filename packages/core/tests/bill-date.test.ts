import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createPurchase,
  createReceipt,
  createSale,
  updateInvoice,
} from "../src/mock/db";

const party = (type: Party["type"]): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 15,
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
  return db;
}

const line = (rate: number): InvoiceLine => ({
  itemId: "item",
  qty: 2,
  rate,
  gstRate: 18,
});

describe("editing a bill's date", () => {
  test("a bill moves within its financial year and keeps its number", () => {
    const db = books();
    const p = createPurchase(db, {
      date: "2026-10-05",
      partyId: "supplier",
      lines: [line(10000)],
    });
    const edited = updateInvoice(
      db,
      p.id,
      { date: "2026-09-20", partyId: "supplier", lines: [line(10000)] },
      "2026-10-26T00:00:00Z",
    );
    expect([edited.date, edited.number, edited.dueDate]).toEqual([
      "2026-09-20",
      p.number,
      "2026-10-05",
    ]);
  });

  test("a bill can't leave its financial year", () => {
    const db = books();
    const p = createPurchase(db, {
      date: "2026-04-02",
      partyId: "supplier",
      lines: [line(10000)],
    });
    expect(() =>
      updateInvoice(
        db,
        p.id,
        { date: "2026-03-31", partyId: "supplier", lines: [line(10000)] },
        "2026-10-26T00:00:00Z",
      ),
    ).toThrow("belongs to financial year 26-27");
  });

  test("money received earlier stops a later date, not an earlier one", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "supplier",
      lines: [line(10000)],
    });
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(20000)],
    });
    createReceipt(db, {
      date: "2026-10-12",
      partyId: "customer",
      amount: 1000,
      mode: "cash",
      ledgerId: "cash",
      allocations: [{ voucherId: sale.id, amount: 1000 }],
    });
    const move = (date: string) =>
      updateInvoice(
        db,
        sale.id,
        { date, partyId: "customer", lines: [line(20000)] },
        "2026-10-26T00:00:00Z",
      );
    expect(() => move("2026-10-15")).toThrow("settles this bill before");
    expect(move("2026-10-11").date).toBe("2026-10-11");
  });

  test("a sale can't move before the stock it uses was bought", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-10-05",
      partyId: "supplier",
      lines: [line(10000)],
    });
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(20000)],
    });
    expect(() =>
      updateInvoice(
        db,
        sale.id,
        { date: "2026-10-01", partyId: "customer", lines: [line(20000)] },
        "2026-10-26T00:00:00Z",
      ),
    ).toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import { createPurchase, createReceipt, createSale } from "../src/mock/db";
import {
  creditApprovalReason,
  overdueBeforeSale,
} from "../src/accounting/creditControl";

const TODAY = "2026-10-26";
const party = (type: Party["type"]): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 10,
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
    TODAY,
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
  createPurchase(db, {
    partyId: "supplier",
    date: "2026-09-01",
    lines: [{ itemId: "item", qty: 50, rate: 10000, gstRate: 18 }],
    charges: [],
    supplierInvoiceNo: "S-1",
  });
  return db;
}
const line: InvoiceLine = { itemId: "item", qty: 1, rate: 10000, gstRate: 18 };
const sale = (db: ReturnType<typeof books>, date: string) =>
  createSale(db, { partyId: "customer", date, lines: [line], charges: [] });
const customer = (db: ReturnType<typeof books>) =>
  db.parties.find((p) => p.id === "customer")!;

describe("credit control (T11)", () => {
  test("a bill past its credit days is overdue; one still within them is not", () => {
    const db = books();
    sale(db, "2026-10-20"); // due 30 Oct
    expect(
      overdueBeforeSale(customer(db), db.vouchers, TODAY).overdueAmount,
    ).toBe(0);
    const old = sale(db, "2026-10-01"); // due 11 Oct
    const summary = overdueBeforeSale(customer(db), db.vouchers, TODAY);
    expect(summary.overdueAmount).toBe(old.amount);
    expect(summary.overdueCount).toBe(1);
    expect(summary.maxOverdueDays).toBe(15);
  });

  test("the sale being saved never counts against itself", () => {
    const db = books();
    const backDated = sale(db, "2026-09-20");
    expect(
      overdueBeforeSale(customer(db), db.vouchers, TODAY, [backDated.id])
        .overdueAmount,
    ).toBe(0);
  });

  test("money on account is set against the oldest overdue bill first", () => {
    const db = books();
    const old = sale(db, "2026-10-01");
    createReceipt(db, {
      partyId: "customer",
      date: "2026-10-25",
      amount: old.amount,
      mode: "cash",
      ledgerId: "cash",
      allocations: [],
    });
    expect(
      overdueBeforeSale(customer(db), db.vouchers, TODAY).overdueAmount,
    ).toBe(0);
  });

  test("who needs an owner's approval", () => {
    const base = {
      creditLimit: 0,
      balanceAfter: 50000,
      overdueAmount: 0,
      policy: "block" as const,
      newSale: true,
    };
    expect(creditApprovalReason(base)).toBeNull();
    expect(creditApprovalReason({ ...base, creditLimit: 40000 })).toBe("limit");
    expect(creditApprovalReason({ ...base, creditLimit: 50000 })).toBeNull();
    expect(creditApprovalReason({ ...base, overdueAmount: 1 })).toBe("overdue");
    // Only "block" stops a sale, and only a new one.
    expect(
      creditApprovalReason({ ...base, overdueAmount: 1, policy: "warn" }),
    ).toBeNull();
    expect(
      creditApprovalReason({ ...base, overdueAmount: 1, policy: "off" }),
    ).toBeNull();
    expect(
      creditApprovalReason({ ...base, overdueAmount: 1, newSale: false }),
    ).toBeNull();
    // The credit limit applies to edits too.
    expect(
      creditApprovalReason({ ...base, creditLimit: 1, newSale: false }),
    ).toBe("limit");
  });
});

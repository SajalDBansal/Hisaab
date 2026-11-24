import { describe, expect, test } from "bun:test";
import type { Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  allocatePartyPayments,
  createNote,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
} from "../src/mock/db";
import { partyBills, unallocatedMoney } from "../src/accounting/bills";
import { voucherPostings } from "../src/accounting/postings";
import {
  refundableByBook,
  unappliedNoteCredit,
} from "../src/accounting/refunds";
import { buildReport } from "../src/reporting";

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
    party("customer"),
    { ...party("supplier"), gstin: "09BBBBB1111B1ZL" },
  ];
  db.items = [
    {
      id: "item",
      name: "Item",
      code: "",
      hsn: "1001",
      group: "",
      taxType: "taxable",
      gstRate: 0,
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
const money = (partyId: string, date: string, amount: number) => ({
  partyId,
  date,
  amount,
  mode: "cash" as const,
  ledgerId: "cash",
  allocations: [],
  bookScope: "gst" as const,
});
const customer = (db: ReturnType<typeof books>) => db.parties[0];
const supplier = (db: ReturnType<typeof books>) => db.parties[1];

describe("refunds (T05)", () => {
  test("a customer's advance is refunded with a payment, up to what is unused", () => {
    const db = books();
    createReceipt(db, money("customer", "2026-10-01", 100000));
    expect(
      refundableByBook(customer(db), db, "2026-10-05", "2026-11-01").gst,
    ).toBe(100000);
    const refund = createPayment(db, money("customer", "2026-10-05", 40000));
    expect(
      voucherPostings(refund).map((p) => [p.account, p.debit, p.credit]),
    ).toEqual([
      ["party:customer", 40000, 0],
      [expect.stringContaining("cash"), 0, 40000],
    ]);
    expect(unallocatedMoney(customer(db), db.vouchers)).toBe(60000);
    expect(() =>
      createPayment(db, money("customer", "2026-10-06", 60001)),
    ).toThrow("unused credit");
  });

  test("a refund settles no bills, keeps no TDS and needs credit", () => {
    const db = books();
    expect(() =>
      createPayment(db, money("customer", "2026-10-05", 100)),
    ).toThrow("unused credit");
    createReceipt(db, money("customer", "2026-10-01", 1000));
    expect(() =>
      createPayment(db, {
        ...money("customer", "2026-10-05", 100),
        allocations: [{ voucherId: "x", amount: 100 }],
      }),
    ).toThrow("A refund doesn't settle bills.");
    // In the other book there is nothing to refund.
    expect(() =>
      createPayment(db, {
        ...money("customer", "2026-10-05", 100),
        bookScope: "nongst",
      }),
    ).toThrow("unused credit");
  });

  test("a supplier pays back our advance with a receipt", () => {
    const db = books();
    createPayment(db, money("supplier", "2026-10-01", 50000));
    expect(unallocatedMoney(supplier(db), db.vouchers)).toBe(50000);
    const back = createReceipt(db, money("supplier", "2026-10-03", 50000));
    expect(
      voucherPostings(back).map((p) => [p.account, p.debit, p.credit]),
    ).toEqual([
      [expect.stringContaining("cash"), 50000, 0],
      ["party:supplier", 0, 50000],
    ]);
    expect(unallocatedMoney(supplier(db), db.vouchers)).toBe(0);
    expect(() => createReceipt(db, money("supplier", "2026-10-04", 1))).toThrow(
      "unused credit",
    );
  });

  test("debit-note credit is applied to a later purchase bill", () => {
    const db = books();
    const bill = createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-01",
      lines: [{ itemId: "item", qty: 10, rate: 10000, gstRate: 0 }],
      charges: [],
      supplierInvoiceNo: "S-1",
    })!;
    createPayment(db, {
      ...money("supplier", "2026-10-02", 100000),
      allocations: [{ voucherId: bill.id, amount: 100000 }],
    });
    // Two returned after the bill was paid: the supplier owes us 20,000.
    const note = createNote(db, "debit-note", {
      againstId: bill.id,
      date: "2026-10-03",
      lines: [{ index: 0, qty: 2 }],
      reason: "Damaged",
    });
    expect(note.allocations ?? []).toEqual([]);
    expect(unappliedNoteCredit(supplier(db), db.vouchers, "2026-10-26")).toBe(
      20000,
    );
    const later = createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-05",
      lines: [{ itemId: "item", qty: 5, rate: 10000, gstRate: 0 }],
      charges: [],
      supplierInvoiceNo: "S-2",
    })!;
    // No money on account: only the return credit is applied.
    expect(unallocatedMoney(supplier(db), db.vouchers)).toBe(0);
    const { allocated } = allocatePartyPayments(db, "supplier", "2026-10-26");
    expect(allocated).toBe(20000);
    expect(note.allocations).toEqual([{ voucherId: later.id, amount: 20000 }]);
    const pending = partyBills(supplier(db), db.vouchers, "2026-10-26").find(
      (b) => b.id === later.id,
    )!.pending;
    expect(pending).toBe(30000);
    expect(unappliedNoteCredit(supplier(db), db.vouchers, "2026-10-26")).toBe(
      0,
    );
  });

  test("credit-note credit can be refunded instead", () => {
    const db = books();
    createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-01",
      lines: [{ itemId: "item", qty: 10, rate: 10000, gstRate: 0 }],
      charges: [],
      supplierInvoiceNo: "S-1",
    });
    const sale = createSale(db, {
      partyId: "customer",
      date: "2026-10-02",
      lines: [{ itemId: "item", qty: 2, rate: 20000, gstRate: 0 }],
      charges: [],
    });
    const sold = Array.isArray(sale) ? sale[0] : sale;
    createReceipt(db, {
      ...money("customer", "2026-10-02", 40000),
      allocations: [{ voucherId: sold.id, amount: 40000 }],
    });
    createNote(db, "credit-note", {
      againstId: sold.id,
      date: "2026-10-04",
      lines: [{ index: 0, qty: 1 }],
      reason: "Returned",
    });
    expect(unappliedNoteCredit(customer(db), db.vouchers, "2026-10-26")).toBe(
      20000,
    );
    createPayment(db, money("customer", "2026-10-06", 20000));
    expect(unappliedNoteCredit(customer(db), db.vouchers, "2026-10-26")).toBe(
      0,
    );
    const doc = buildReport(db, {
      report: "refunds",
      from: "2026-04-01",
      to: "2026-10-26",
      includeNarration: false,
      includeZeroBalances: false,
    });
    const rows = doc.sections[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toContain("To customer");
    expect(rows[1].total).toBe(true);
    expect(rows[1].cells.at(-1)).toBe(20000);
  });
});

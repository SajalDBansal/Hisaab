import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  cancelVoucher,
  createOrder,
  createPurchase,
  createReceipt,
  createSale,
  restoreBlocker,
  restoreVoucher,
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

const line = (qty: number, rate: number): InvoiceLine => ({
  itemId: "item",
  qty,
  rate,
  gstRate: 18,
});
const AT = "2026-10-26T00:00:00Z";

function stocked(qty = 2) {
  const db = books();
  createPurchase(db, {
    date: "2026-10-01",
    partyId: "supplier",
    lines: [line(qty, 10000)],
  });
  return db;
}

describe("restoring a cancelled voucher (doc 37, T47)", () => {
  test("a cancelled sale comes back with its number and an edit-log entry", () => {
    const db = stocked();
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(2, 20000)],
    });
    cancelVoucher(db, sale.id, "Wrong customer", AT);
    expect(restoreBlocker(db, sale)).toBeNull();
    const back = restoreVoucher(db, sale.id);
    expect([back.status, back.number, back.cancelReason]).toEqual([
      "posted",
      sale.number,
      undefined,
    ]);
    expect(db.auditLog.at(-1)).toMatchObject({
      action: "restored",
      voucherId: sale.id,
      note: "Cancelled for: Wrong customer",
    });
  });

  test("only cancelled entries can be restored", () => {
    const db = stocked();
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(1, 20000)],
    });
    expect(() => restoreVoucher(db, sale.id)).toThrow("Only cancelled");
  });

  test("refused when its stock has been sold again since", () => {
    const db = stocked(2);
    const first = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(2, 20000)],
    });
    cancelVoucher(db, first.id, "Duplicate", AT);
    createSale(db, {
      date: "2026-10-11",
      partyId: "customer",
      lines: [line(2, 20000)],
    });
    expect(restoreBlocker(db, first)).toContain("stock has been used");
    expect(() => restoreVoucher(db, first.id)).toThrow();
    expect(first.status).toBe("cancelled");
  });

  test("refused when the bill it settled has been settled by others since", () => {
    const db = stocked();
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(1, 20000)],
    });
    const money = (amount: number) =>
      createReceipt(db, {
        date: "2026-10-12",
        partyId: "customer",
        amount,
        mode: "cash",
        ledgerId: "cash",
        allocations: [{ voucherId: sale.id, amount }],
      });
    const receipt = money(sale.amount);
    cancelVoucher(db, receipt.id, "Bounced", AT);
    money(sale.amount);
    expect(restoreBlocker(db, receipt)).toContain("settled by other entries");
  });

  test("a bill made from an order converts the order again, unless it was converted since", () => {
    const db = stocked();
    const order = createOrder(db, "sales-order", {
      date: "2026-10-05",
      partyId: "customer",
      lines: [line(1, 20000)],
    });
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line(1, 20000)],
      sourceId: order.id,
    });
    cancelVoucher(db, sale.id, "Wrong rate", AT);
    expect(order.convertedToId).toBeUndefined();
    restoreVoucher(db, sale.id);
    expect(order.convertedToId).toBe(sale.id);

    cancelVoucher(db, sale.id, "Wrong rate", AT);
    const replacement = createSale(db, {
      date: "2026-10-11",
      partyId: "customer",
      lines: [line(1, 21000)],
      sourceId: order.id,
    });
    expect(restoreBlocker(db, sale)).toContain(
      `has been turned into ${replacement.number}`,
    );
  });
});

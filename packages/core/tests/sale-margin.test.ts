import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import { createPurchase, createSales, draftSaleMargin } from "../src/mock/db";
import { marginShare, withoutCosts } from "../src/accounting/saleMargin";
import { presetRights, roleFlag } from "../src/roles";
import { canSeeCosts } from "../src/permissions";

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
      altUnit: { name: "Box", factor: 10 },
      purchasePrice: 10000,
      salePrice: 20000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  const buy = (date: string, qty: number, rate: number) =>
    createPurchase(db, {
      date,
      partyId: "supplier",
      lines: [{ itemId: "item", qty, rate, gstRate: 18 }],
    }).lines![0].stockLotId!;
  return { db, buy };
}

const line = (patch: Partial<InvoiceLine> = {}): InvoiceLine => ({
  itemId: "item",
  qty: 1,
  rate: 20000,
  gstRate: 18,
  ...patch,
});

describe("profit margin on the sale form (T12)", () => {
  test("cost is FIFO across batches; margin is taxable value less cost", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    buy("2026-10-02", 10, 12000);
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 15 })],
    });
    // 10 × ₹100 + 5 × ₹120 = ₹1,600 cost; 15 × ₹200 = ₹3,000 taxable
    expect(result.lines[0]).toEqual({
      taxable: 300000,
      cost: 160000,
      margin: 140000,
      marginPercent: 46.67,
    });
    expect(result.total).toEqual(result.lines[0]);
    expect(result.missing).toBe(0);
  });

  test("matches the cost the saved sale records, and saves nothing", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    buy("2026-10-02", 10, 12000);
    const input = {
      date: "2026-10-10",
      lines: [line({ qty: 4, discountPercent: 10 }), line({ qty: 9 })],
    };
    const before = db.vouchers.length;
    const result = draftSaleMargin(db, input);
    expect(db.vouchers.length).toBe(before);
    const [sale] = createSales(db, {
      ...input,
      partyId: "customer",
      charges: [],
    });
    const saved = sale.lines!.reduce((sum, l) => sum + (l.stockCost ?? 0), 0);
    expect(result.total.cost).toBe(saved);
    // The second line starts where the first left off: 6 at ₹100, 3 at ₹120.
    expect(result.lines.map((l) => l.cost)).toEqual([40000, 96000]);
    // Discount comes off before the margin: 4 × ₹200 less 10% = ₹720.
    expect(result.lines[0].taxable).toBe(72000);
    expect(result.lines[0].margin).toBe(32000);
  });

  test("a chosen batch is costed at that batch", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const b = buy("2026-10-02", 10, 12000);
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 2, stockLotId: b })],
    });
    expect(result.lines[0].cost).toBe(24000);
  });

  test("a line sold below cost shows a negative margin", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 2, rate: 9000 })],
    });
    expect(result.lines[0].margin).toBe(-2000);
    expect(result.lines[0].marginPercent).toBe(-11.11);
  });

  test("a line without stock has no cost and is left out of the total", () => {
    const { db, buy } = books();
    buy("2026-10-01", 3, 10000);
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 2 }), line({ qty: 5 })],
    });
    expect(result.lines[1].cost).toBeNull();
    expect(result.lines[1].margin).toBeNull();
    expect(result.lines[1].problem).toBeTruthy();
    expect(result.missing).toBe(1);
    expect(result.total).toEqual(result.lines[0]);
    // Stock bought after the bill date doesn't count.
    const early = draftSaleMargin(db, {
      date: "2026-09-30",
      lines: [line()],
    });
    expect(early.total.cost).toBeNull();
    expect(early.missing).toBe(1);
  });

  test("a line in the second unit uses the item's pack size", () => {
    const { db, buy } = books();
    buy("2026-10-01", 30, 10000);
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 2, rate: 180000, per: { unit: "Box", factor: 1 } })],
    });
    // 20 Nos at ₹100: the factor comes from the item, not the app.
    expect(result.lines[0].cost).toBe(200000);
    expect(result.lines[0].margin).toBe(160000);
  });

  test("an edit may reuse the stock the bill already took", () => {
    const { db, buy } = books();
    buy("2026-10-01", 5, 10000);
    buy("2026-10-02", 5, 12000);
    const [sale] = createSales(db, {
      date: "2026-10-10",
      partyId: "customer",
      charges: [],
      lines: [line({ qty: 5 })],
    });
    const result = draftSaleMargin(db, {
      date: "2026-10-10",
      editingId: sale.id,
      lines: [line({ qty: 5, rate: 25000 })],
    });
    // The row keeps its saved batch (₹100), as updateInvoice does.
    expect(result.lines[0].cost).toBe(50000);
    // As a new sale the same line would take the next batch (₹120).
    const fresh = draftSaleMargin(db, {
      date: "2026-10-10",
      lines: [line({ qty: 5, rate: 25000 })],
    });
    expect(fresh.lines[0].cost).toBe(60000);
    expect(() =>
      draftSaleMargin(db, {
        date: "2026-10-10",
        editingId: "nope",
        lines: [line()],
      }),
    ).toThrow("Bill not found");
  });

  test("costs can be dropped for roles that see margins but not rates", () => {
    const { db, buy } = books();
    buy("2026-10-01", 5, 10000);
    const result = withoutCosts(
      draftSaleMargin(db, { date: "2026-10-10", lines: [line()] }),
    );
    expect(result.lines[0].cost).toBeNull();
    expect(result.total.cost).toBeNull();
    expect(result.total.margin).toBe(10000);
  });

  test("percent is of the taxable value; none on a zero value", () => {
    expect(marginShare(2500, 10000)).toBe(25);
    expect(marginShare(0, 0)).toBeNull();
  });

  test("built-in roles: owner and accountant see margins; sales and viewer never", () => {
    expect(roleFlag("owner", "viewProfitMargin")).toBe(true);
    expect(roleFlag("accountant", "viewProfitMargin")).toBe(true);
    expect(roleFlag("sales", "viewProfitMargin")).toBe(false);
    expect(roleFlag("viewer", "viewProfitMargin")).toBe(false);
    expect(presetRights("sales").flags.hidePurchaseRate).toBe(true);
    expect(canSeeCosts("sales")).toBe(false);
  });
});

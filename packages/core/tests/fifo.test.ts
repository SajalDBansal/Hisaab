import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createNote,
  createPurchase,
  createSale,
  createSales,
} from "../src/mock/db";
import {
  allocateStock,
  STOCK_BOOK_CHOICE_MESSAGE,
  stockLots,
} from "../src/accounting/stockLots";
import { calcInvoice, calcLine } from "../src/accounting/invoice";
import { printRows } from "../src/print/voucherHtml";

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
  const buy = (date: string, qty: number, rate: number, bookScope?: "nongst") =>
    createPurchase(db, {
      date,
      partyId: "supplier",
      bookScope,
      lines: [{ itemId: "item", qty, rate, gstRate: 18 }],
    }).lines![0].stockLotId!;
  return { db, buy };
}

const sell = (
  db: ReturnType<typeof books>["db"],
  line: Partial<InvoiceLine>,
  date = "2026-10-10",
) =>
  createSales(db, {
    date,
    partyId: "customer",
    lines: [{ itemId: "item", qty: 1, rate: 20000, gstRate: 18, ...line }],
  });

describe("automatic FIFO stock", () => {
  test("a sale larger than the oldest batch takes the next batch too", () => {
    const { db, buy } = books();
    const a = buy("2026-10-01", 10, 10000);
    const b = buy("2026-10-02", 10, 12000);
    const [sale] = sell(db, { qty: 15 });
    expect(sale.lines!.map((l) => [l.stockLotId, l.qty, l.stockCost])).toEqual([
      [a, 10, 100000],
      [b, 5, 60000],
    ]);
    expect(sale.amount).toBe(
      calcInvoice({
        lines: [
          {
            itemId: "item",
            qty: 15,
            rate: 20000,
            gstRate: 18,
            exactMath: true,
          },
        ],
        interState: false,
      }).grandTotal,
    );
    const left = stockLots(db.items[0], db.vouchers).filter((l) => l.qty > 0);
    expect(left.map((l) => [l.id, l.qty, l.value])).toEqual([[b, 5, 60000]]);
  });

  test("a return against one batch row restores that batch at its cost", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const b = buy("2026-10-02", 10, 12000);
    const [sale] = sell(db, { qty: 15 });
    createNote(db, "credit-note", {
      againstId: sale.id,
      date: "2026-10-11",
      reason: "Returned",
      lines: [{ index: 1, qty: 5 }],
    });
    const lotB = stockLots(db.items[0], db.vouchers).find((l) => l.id === b)!;
    expect([lotB.qty, lotB.value]).toEqual([10, 120000]);
  });

  test("stock in both books needs the sale to say which book", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const n = buy("2026-10-02", 10, 9000, "nongst");
    expect(() => sell(db, { qty: 2 })).toThrow(STOCK_BOOK_CHOICE_MESSAGE);
    const [sale] = sell(db, { qty: 2, bookScope: "nongst" });
    expect(sale.lines![0].stockLotId).toBe(n);
    expect(sale.bookScope).toBe("nongst");
  });

  test("a flat discount is shared by quantity and adds up exactly", () => {
    const { db, buy } = books();
    buy("2026-10-01", 1, 10000);
    buy("2026-10-02", 2, 10000);
    const [sale] = sell(db, { qty: 3, discountAmount: 1000 });
    expect(sale.lines!.map((l) => l.discountAmount)).toEqual([333, 667]);
  });

  test("not enough stock is refused before anything is saved", () => {
    const { db, buy } = books();
    buy("2026-10-01", 4, 10000);
    expect(() => sell(db, { qty: 5 })).toThrow("Only 4 units are in GST stock");
    expect(db.vouchers.filter((v) => v.type === "sale")).toHaveLength(0);
  });

  test("a chosen batch overrides FIFO", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const b = buy("2026-10-02", 10, 12000);
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [
        { itemId: "item", qty: 3, rate: 20000, gstRate: 18, stockLotId: b },
      ],
    });
    expect(sale.lines!.map((l) => l.stockLotId)).toEqual([b]);
  });

  test("second-unit lines split only when each part fits three decimals", () => {
    const { db, buy } = books();
    buy("2026-10-01", 15, 1000);
    buy("2026-10-02", 15, 1000);
    const [sale] = sell(db, {
      qty: 2,
      rate: 20000,
      per: { unit: "Box", factor: 10 },
    });
    expect(sale.lines!.map((l) => l.qty)).toEqual([1.5, 0.5]);
  });

  test("allocation never changes the lots it was given", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    const lots = stockLots(db.items[0], db.vouchers);
    const before = structuredClone(lots);
    allocateStock(lots, [{ itemId: "item", qty: 4, rate: 1, gstRate: 18 }]);
    expect(lots).toEqual(before);
  });
});

describe("printed invoice", () => {
  test("lot rows of one entered line print as a single row", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    buy("2026-10-02", 10, 12000);
    const [sale] = sell(db, { qty: 15, discountAmount: 1500 });
    const rows = printRows(sale.lines!, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].line.qty).toBe(15);
    expect(rows[0].lt.discount).toBe(1500);
    expect(rows[0].lt.total).toBe(
      sale.lines!.reduce((s, l) => s + calcLine(l, false).total, 0),
    );
  });
  test("different prices stay on separate rows", () => {
    const rows = printRows(
      [
        { itemId: "item", qty: 1, rate: 100, gstRate: 18 },
        { itemId: "item", qty: 1, rate: 120, gstRate: 18 },
      ],
      false,
    );
    expect(rows).toHaveLength(2);
  });
});

describe("split sale is all or nothing", () => {
  test("a failure after the first bill leaves the books untouched", () => {
    const { db, buy } = books();
    buy("2026-10-01", 10, 10000);
    buy("2026-10-02", 10, 9000, "nongst");
    const before = structuredClone({
      vouchers: db.vouchers,
      counters: db.counters,
      auditLog: db.auditLog,
    });
    // Two books -> two invoices; paying more than both totals fails after the first is built.
    expect(() =>
      createSales(db, {
        date: "2026-10-10",
        partyId: "customer",
        lines: [
          {
            itemId: "item",
            qty: 1,
            rate: 20000,
            gstRate: 18,
            bookScope: "gst",
          },
          {
            itemId: "item",
            qty: 1,
            rate: 20000,
            gstRate: 18,
            bookScope: "nongst",
          },
        ],
        paidNow: { amount: 99_999_999, mode: "cash", ledgerId: "cash" },
      }),
    ).toThrow("The payment exceeds the invoice totals.");
    expect({
      vouchers: db.vouchers,
      counters: db.counters,
      auditLog: db.auditLog,
    }).toEqual(before);
  });
});

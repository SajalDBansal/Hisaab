import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party, Voucher } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  cancelVoucher,
  createOrder,
  createPurchase,
  createSale,
} from "../src/mock/db";
import {
  createPlannedFulfillments,
  orderLineBalances,
  planOrderFulfillment,
} from "../src/accounting/orderFulfillment";
import { stockLots } from "../src/accounting/stockLots";
import { stockQty } from "../src/accounting/stock";
import { challanMovesStock } from "../src/accounting/challans";
import { voucherHtml } from "../src/print/voucherHtml";
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
    date: "2026-10-01",
    lines: [{ itemId: "item", qty: 10, rate: 10000, gstRate: 18 }],
    charges: [],
    supplierInvoiceNo: "S-1",
  });
  return db;
}

const line: InvoiceLine = { itemId: "item", qty: 3, rate: 20000, gstRate: 18 };
const challan = (
  db: ReturnType<typeof books>,
  extra: Partial<Parameters<typeof createOrder>[2]> = {},
) =>
  createOrder(db, "delivery-note", {
    partyId: "customer",
    date: "2026-10-10",
    lines: [line],
    charges: [],
    ...extra,
  });
const qty = (db: ReturnType<typeof books>) =>
  stockQty(db.items[0], db.vouchers);

/** Bill a challan through order fulfilment, as the server does. */
function bill(db: ReturnType<typeof books>, source: Voucher, n = 3) {
  const lines = [
    { id: "l0", sourceId: source.id, position: 0, line: source.lines![0] },
  ];
  const plan = planOrderFulfillment({
    source: { ...source, fulfillmentManaged: true },
    balances: orderLineBalances(source, lines, [], []),
    target: "sale",
    date: "2026-10-12",
    today: "2026-10-26",
    selections: [{ sourceLineId: "l0", qty: n }],
    availableStockLots: db.items.flatMap((item) =>
      stockLots(item, db.vouchers, "2026-10-12"),
    ),
  });
  source.fulfillmentManaged = true;
  return createPlannedFulfillments(db, plan)[0];
}

describe("delivery challans (T04)", () => {
  test("by default a challan moves stock, as before, and records it", () => {
    const db = books();
    const dc = challan(db);
    expect(dc.challanType).toBe("supply");
    expect(dc.challanStock).toBe(true);
    expect(dc.lines![0].stockLotId).toBeDefined();
    expect(qty(db)).toBe(7);
    const sale = bill(db, dc);
    expect(sale.lines![0].stockFulfilledById).toBe(dc.id);
    expect(qty(db)).toBe(7); // the invoice does not take it again
  });

  test("cancelling a stock challan returns the stock", () => {
    const db = books();
    const dc = challan(db);
    expect(qty(db)).toBe(7);
    cancelVoucher(db, dc.id, "Not sent");
    expect(qty(db)).toBe(10);
  });

  test("with the setting off a challan is paperwork and the invoice takes the stock", () => {
    const db = books();
    db.salesControls = {
      overdueSales: "warn",
      challanStock: false,
      version: 1,
    };
    const dc = challan(db, { challanType: "approval" });
    expect(dc.challanStock).toBe(false);
    expect(challanMovesStock(dc)).toBe(false);
    expect(dc.lines![0].stockLotId).toBeUndefined();
    expect(qty(db)).toBe(10);
    const sale = bill(db, dc, 2);
    expect(sale.lines![0].stockFulfilledById).toBeUndefined();
    expect(sale.lines![0].stockLotId).toBeDefined();
    expect(qty(db)).toBe(8);
  });

  test("the legacy conversion from a paperwork challan takes the stock on the sale", () => {
    const db = books();
    db.salesControls = {
      overdueSales: "warn",
      challanStock: false,
      version: 1,
    };
    const dc = challan(db);
    createSale(db, {
      partyId: "customer",
      date: "2026-10-12",
      lines: [line],
      charges: [],
      sourceId: dc.id,
    });
    expect(qty(db)).toBe(7);
  });

  test("changing the setting never re-books challans already issued", () => {
    const db = books();
    const moved = challan(db);
    db.salesControls = {
      overdueSales: "warn",
      challanStock: false,
      version: 1,
    };
    const paper = challan(db, { challanType: "job-work" });
    expect(qty(db)).toBe(7);
    db.salesControls.challanStock = true;
    expect(qty(db)).toBe(7);
    expect(challanMovesStock(moved)).toBe(true);
    expect(challanMovesStock(paper)).toBe(false);
    // A challan saved before the field existed moved stock.
    expect(challanMovesStock({ type: "delivery-note" })).toBe(true);
  });

  test("a challan type belongs only to challans and is printed", () => {
    const db = books();
    expect(() =>
      createOrder(db, "sales-order", {
        partyId: "customer",
        date: "2026-10-10",
        lines: [line],
        charges: [],
        challanType: "job-work",
      }),
    ).toThrow("Only a delivery challan has a challan type.");
    const dc = challan(db, { challanType: "job-work" });
    const { html } = voucherHtml({
      firm: db.firm,
      voucher: dc,
      party: db.parties[0],
      items: db.items,
      settings: db.invoiceSettings,
    });
    expect(html).toContain("Purpose");
    expect(html).toContain("Job work");
  });

  test("the challan register shows purpose and where stock moves", () => {
    const db = books();
    challan(db);
    db.salesControls = {
      overdueSales: "warn",
      challanStock: false,
      version: 1,
    };
    challan(db, { challanType: "approval" });
    const doc = buildReport(db, {
      report: "delivery-notes-register",
      from: "2026-04-01",
      to: "2026-10-26",
      includeNarration: false,
      includeZeroBalances: false,
    });
    const cells = doc.sections[0].rows.map((r) => r.cells);
    expect(doc.sections[0].columns.map((c) => c.label)).toContain("Purpose");
    expect(cells[0]).toContain("On challan");
    expect(cells[1]).toContain("Sale on approval");
    expect(cells[1]).toContain("On invoice");
  });
});

import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party, Voucher } from "../src/types";
import { blankBooks, buildSeed } from "../src/mock/seed";
import {
  createNote,
  createOrder,
  createPurchase,
  createSale,
  createSales,
  updateInvoice,
  updateInvoiceSettings,
} from "../src/mock/db";
import {
  allocateBillDiscount,
  apportion,
  calcInvoice,
  exclusiveRate,
  inclusiveRate,
  splitBillDiscount,
} from "../src/accounting/invoice";
import { checkChargeHeads } from "../src/accounting/chargeHeads";
import { postingTotals, voucherPostings } from "../src/accounting/postings";
import { billTaxSplit, gstr1 } from "../src/accounting/gst";
import {
  orderLineBalances,
  planOrderFulfillment,
} from "../src/accounting/orderFulfillment";
import { voucherHtml } from "../src/print/voucherHtml";

const party = (type: Party["type"], gstin?: string): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  gstin,
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
    party("customer", "09CCCCC2222C1Z5"),
    party("supplier", "09BBBBB1111B1ZL"),
  ];
  const item = (id: string, gstRate: 5 | 18) => ({
    id,
    name: id.toUpperCase(),
    code: "",
    hsn: "1001",
    group: "",
    taxType: "taxable" as const,
    gstRate,
    unit: "Nos",
    purchasePrice: 10000,
    salePrice: 20000,
    mrp: 0,
    reorderLevel: 0,
    openingStock: 100,
  });
  db.items = [item("a", 18), item("b", 5)];
  db.invoiceSettings.chargeHeads = [
    {
      id: "packing",
      name: "Packing",
      taxType: "taxable",
      gstRate: 18,
      sac: "998540",
      active: true,
    },
    {
      id: "loading",
      name: "Loading",
      taxType: "exempt",
      gstRate: 0,
      active: true,
    },
    {
      id: "cartage",
      name: "Cartage",
      taxType: "nongst",
      gstRate: 0,
      salesLedger: "Cartage Recovered",
      purchaseLedger: "Cartage Inward",
      active: true,
    },
  ];
  return db;
}

const printed = (db: ReturnType<typeof books>, v: Voucher) =>
  voucherHtml({
    firm: db.firm,
    voucher: v,
    party: db.parties[0],
    items: db.items,
    settings: db.invoiceSettings,
  }).html;

const lines: InvoiceLine[] = [
  { itemId: "a", qty: 3, rate: 10000, gstRate: 18 },
  { itemId: "b", qty: 1, rate: 33333, gstRate: 5, discountPercent: 10 },
];
const sale = (db: ReturnType<typeof books>, extra = {}) =>
  createSale(db, {
    partyId: "customer",
    date: "2026-10-20",
    lines,
    charges: [],
    ...extra,
  });

describe("existing vouchers keep their totals (T09)", () => {
  test("every demo bill computes the amount it was saved with", () => {
    const db = buildSeed("2026-10-26");
    const bills = db.vouchers.filter(
      (v) => v.type === "sale" || v.type === "purchase",
    );
    expect(bills.length).toBeGreaterThan(5);
    for (const v of bills) {
      const t = calcInvoice({
        lines: v.lines ?? [],
        charges: v.charges,
        interState: !!v.interState,
      });
      expect(t.grandTotal).toBe(v.amount);
      expect(t.billDiscount).toBe(0);
      expect(postingTotals(voucherPostings(v)).balanced).toBe(true);
    }
  });

  test("a bill without a subtotal discount or heads saves exactly as before", () => {
    const db = books();
    const v = sale(db, {
      charges: [{ name: "Freight", amount: 5000, gstRate: 18 }],
    });
    expect(v.billDiscount).toBeUndefined();
    expect(v.lines?.every((l) => l.billDiscountShare === undefined)).toBe(true);
    // 30000 + 18% and 33333 − 10% (30000) + 5%, freight 5000 + 18%
    expect(v.amount).toBe(Math.round((35400 + 31500 + 5900) / 100) * 100);
    const rows = voucherPostings(v, { party: "C" });
    expect(
      rows.find((r) => r.account === "income:Freight Charged")?.credit,
    ).toBe(5000);
    expect(postingTotals(rows).balanced).toBe(true);
  });
});

describe("round off", () => {
  test("rounding to the rupee posts to the Round Off account", () => {
    const db = books();
    const v = sale(db, { billDiscount: { amount: 1234 } });
    const t = calcInvoice({ lines: v.lines!, interState: false });
    expect(t.roundOff).not.toBe(0);
    expect(v.amount % 100).toBe(0);
    const rows = voucherPostings(v, { party: "C" });
    const round = rows.find((r) => r.account === "round-off");
    expect(round?.ledger).toBe("Round Off");
    expect((round?.credit ?? 0) - (round?.debit ?? 0)).toBe(t.roundOff);
    expect(postingTotals(rows).balanced).toBe(true);
  });
});

describe("subtotal discount", () => {
  test("apportion gives whole paise that add up", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(0, [5, 5])).toEqual([0, 0]);
    expect(apportion(7, [0, 0])).toEqual([0, 0]);
    expect(apportion(1001, [30000, 30000]).reduce((a, b) => a + b)).toBe(1001);
  });

  test("a percentage is taken of the subtotal and spread by value", () => {
    const { lines: out, billDiscount } = allocateBillDiscount(
      lines.map((l) => ({ ...l, exactMath: true })),
      { percent: 5 },
    );
    // subtotal 30000 + 30000 = 60000 → 3000, 1500 each
    expect(billDiscount).toEqual({ percent: 5, amount: 3000 });
    expect(out.map((l) => l.billDiscountShare)).toEqual([1500, 1500]);
    expect(
      allocateBillDiscount(out).lines[0].billDiscountShare,
    ).toBeUndefined();
  });

  test("GST is charged on the discounted value; postings balance", () => {
    const db = books();
    const v = sale(db, { billDiscount: { amount: 6000 } });
    expect(v.billDiscount).toEqual({ amount: 6000 });
    const t = calcInvoice({
      lines: v.lines!,
      charges: v.charges,
      interState: false,
    });
    expect(t.billDiscount).toBe(6000);
    expect(t.itemsTaxable).toBe(54000);
    expect(t.lines[0].taxable).toBe(27000);
    expect(t.lines[0].tax).toBe(4860);
    expect(t.lines[1].taxable).toBe(27000);
    expect(t.lines[1].tax).toBe(1350);
    expect(v.amount).toBe(t.grandTotal);
    const rows = voucherPostings(v, { party: "C" });
    expect(rows.find((r) => r.account === "sales")?.credit).toBe(54000);
    expect(postingTotals(rows).balanced).toBe(true);
    // GSTR-1 uses the discounted value
    const r1 = gstr1(db.vouchers, db.parties, db.items, "2026-10");
    expect(r1.b2b[0].taxable).toBe(54000);
    expect(r1.hsn.reduce((s, h) => s + h.taxable, 0)).toBe(54000);
  });

  test("an amount above the subtotal is capped", () => {
    const db = books();
    const v = sale(db, { billDiscount: { amount: 10_000_000 } });
    expect(v.billDiscount?.amount).toBe(60000);
    expect(v.amount).toBe(0);
  });

  test("an edit re-spreads or removes the discount", () => {
    const db = books();
    const v = sale(db, { billDiscount: { percent: 10 } });
    const edited = updateInvoice(db, v.id, {
      partyId: "customer",
      date: v.date,
      lines,
      charges: [],
      billDiscount: { percent: 20 },
    });
    expect(edited.billDiscount).toEqual({ percent: 20, amount: 12000 });
    const cleared = updateInvoice(db, v.id, {
      partyId: "customer",
      date: v.date,
      lines,
      charges: [],
    });
    expect(cleared.billDiscount).toBeUndefined();
    expect(cleared.lines?.some((l) => l.billDiscountShare)).toBe(false);
  });

  test("returns of a discounted bill reverse its discounted value exactly", () => {
    const db = books();
    const v = sale(db, { billDiscount: { percent: 7.5 } });
    const first = createNote(db, "credit-note", {
      againstId: v.id,
      date: "2026-10-22",
      lines: [{ index: 0, qty: 1 }],
      reason: "Damaged",
    });
    const rest = createNote(db, "credit-note", {
      againstId: v.id,
      date: "2026-10-23",
      lines: [
        { index: 0, qty: 2 },
        { index: 1, qty: 1 },
      ],
      reason: "Damaged",
    });
    expect(first.lines?.[0].billDiscountShare).toBeUndefined();
    expect(first.amount + rest.amount).toBe(v.amount);
    const billTax = billTaxSplit(v).taxed;
    const back = [first, rest].map((n) => billTaxSplit(n).taxed);
    expect(back[0].taxable + back[1].taxable).toBe(billTax.taxable);
    expect(back[0].cgst + back[1].cgst).toBe(billTax.cgst);
    for (const note of [first, rest])
      expect(postingTotals(voucherPostings(note)).balanced).toBe(true);
  });

  test("purchase stock cost is the discounted value", () => {
    const db = books();
    const p = createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-01",
      lines: [{ itemId: "a", qty: 10, rate: 10000, gstRate: 18 }],
      charges: [],
      supplierInvoiceNo: "S-1",
      billDiscount: { percent: 10 },
    });
    expect(p.lines?.[0].stockCost).toBe(90000);
  });

  test("split GST / non-GST sales share an amount by value", () => {
    const parts = splitBillDiscount({ amount: 1000 }, [
      [{ itemId: "a", qty: 1, rate: 30000, gstRate: 18 }],
      [{ itemId: "b", qty: 1, rate: 10000, gstRate: 0 }],
    ]);
    expect(parts).toEqual([{ amount: 750 }, { amount: 250 }]);
    expect(splitBillDiscount({ percent: 5 }, [[], []])).toEqual([
      { percent: 5 },
      { percent: 5 },
    ]);
    const db = books();
    const saved = createSales(db, {
      partyId: "customer",
      date: "2026-10-20",
      lines,
      charges: [],
      billDiscount: { amount: 1000 },
    });
    expect(saved.reduce((s, v) => s + (v.billDiscount?.amount ?? 0), 0)).toBe(
      1000,
    );
  });

  test("orders keep the discount and conversions carry it in parts", () => {
    const db = books();
    const estimate = createOrder(db, "estimate", {
      partyId: "customer",
      date: "2026-10-20",
      lines: [{ itemId: "a", qty: 3, rate: 10000, gstRate: 18 }],
      charges: [],
      billDiscount: { amount: 1000 },
    });
    expect(estimate.billDiscount).toEqual({ amount: 1000 });
    const sourceLines = [
      {
        id: "l0",
        sourceId: estimate.id,
        position: 0,
        line: estimate.lines![0],
      },
    ];
    const plan = (qty: number, consumed: number) => {
      const target: Voucher = {
        ...estimate,
        id: "t1",
        type: "sales-order",
        status: "posted",
      };
      const balances = orderLineBalances(
        estimate,
        sourceLines,
        consumed
          ? [
              {
                sourceLineId: "l0",
                targetId: "t1",
                targetPosition: 0,
                qty: consumed,
              },
            ]
          : [],
        consumed ? [target] : [],
      );
      return planOrderFulfillment({
        source: estimate,
        balances,
        target: "sales-order",
        date: "2026-10-21",
        today: "2026-10-26",
        selections: [{ sourceLineId: "l0", qty }],
      });
    };
    const firstPart = plan(1, 0).batches[0].billDiscount?.amount ?? 0;
    const lastPart = plan(2, 1).batches[0].billDiscount?.amount ?? 0;
    expect(firstPart).toBe(333);
    expect(firstPart + lastPart).toBe(1000);
    const pct = createOrder(db, "estimate", {
      partyId: "customer",
      date: "2026-10-20",
      lines: [{ itemId: "a", qty: 3, rate: 10000, gstRate: 18 }],
      charges: [],
      billDiscount: { percent: 5 },
    });
    const balances = orderLineBalances(
      pct,
      [{ id: "p0", sourceId: pct.id, position: 0, line: pct.lines![0] }],
      [],
      [],
    );
    const pctPlan = planOrderFulfillment({
      source: pct,
      balances,
      target: "sales-order",
      date: "2026-10-21",
      today: "2026-10-26",
      selections: [{ sourceLineId: "p0", qty: 1 }],
    });
    expect(pctPlan.batches[0].billDiscount).toEqual({ percent: 5 });
  });

  test("print shows the subtotal and the discount", () => {
    const db = books();
    const v = sale(db, { billDiscount: { percent: 5 } });
    const html = printed(db, v);
    expect(html).toContain("Discount (5%)");
    expect(html).toContain("Sub total");
  });
});

describe("charge heads", () => {
  test("a charge from a head freezes its treatment and posts to its ledger", () => {
    const db = books();
    const v = sale(db, {
      charges: [
        { name: "Packing", amount: 10000, gstRate: 0, headId: "packing" },
        { name: "", amount: 2000, gstRate: 18, headId: "loading" },
        { name: "", amount: 3000, gstRate: 18, headId: "cartage" },
        { name: "Freight", amount: 5000, gstRate: 18 },
      ],
    });
    expect(v.charges?.map((c) => [c.name, c.gstRate, c.taxType])).toEqual([
      ["Packing", 18, "taxable"],
      ["Loading", 0, "exempt"],
      ["Cartage", 0, "nongst"],
      ["Freight", 18, undefined],
    ]);
    const rows = voucherPostings(v, { party: "C" });
    expect(
      rows.find((r) => r.account === "income:Packing Charged")?.credit,
    ).toBe(10000);
    expect(
      rows.find((r) => r.account === "income:Cartage Recovered")?.credit,
    ).toBe(3000);
    expect(
      rows.find((r) => r.account === "income:Freight Charged")?.credit,
    ).toBe(5000);
    expect(postingTotals(rows).balanced).toBe(true);
    const split = billTaxSplit(v);
    expect(split.noTax.exempt).toBe(2000);
    expect(split.noTax.nonGst).toBe(3000);
    const r1 = gstr1(db.vouchers, db.parties, db.items, "2026-10");
    expect(r1.hsn.find((h) => h.hsn === "998540")?.taxable).toBe(10000);
    expect(r1.hsn.some((h) => h.description === "Cartage")).toBe(false);
    const html = printed(db, v);
    expect(html).toContain("Packing");
    expect(html).toContain("Exempt");
    // Changing the head later never changes the saved bill.
    updateInvoiceSettings(db, {
      chargeHeads: db.invoiceSettings.chargeHeads!.map((h) =>
        h.id === "packing" ? { ...h, gstRate: 5, salesLedger: "Other" } : h,
      ),
    });
    const edited = updateInvoice(db, v.id, {
      partyId: "customer",
      date: v.date,
      lines,
      charges: [
        { name: "Packing", amount: 12000, gstRate: 0, headId: "packing" },
      ],
    });
    expect(edited.charges?.[0]).toMatchObject({
      amount: 12000,
      gstRate: 18,
      account: "income:Packing Charged",
    });
  });

  test("purchases post a head to its expense ledger, with GST as input credit", () => {
    const db = books();
    const p = createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-01",
      lines: [{ itemId: "a", qty: 1, rate: 10000, gstRate: 18 }],
      charges: [{ name: "", amount: 3000, gstRate: 0, headId: "cartage" }],
      supplierInvoiceNo: "S-2",
    });
    const rows = voucherPostings(p, { party: "S" });
    expect(
      rows.find((r) => r.account === "expense:Cartage Inward")?.debit,
    ).toBe(3000);
    expect(postingTotals(rows).balanced).toBe(true);
  });

  test("unknown or switched-off heads are refused", () => {
    const db = books();
    expect(() =>
      sale(db, {
        charges: [{ name: "X", amount: 100, gstRate: 0, headId: "nope" }],
      }),
    ).toThrow("no longer set up");
  });

  test("head lists are checked", () => {
    const head = {
      id: "h",
      name: "Packing",
      taxType: "taxable" as const,
      gstRate: 18 as const,
      active: true,
    };
    expect(checkChargeHeads([{ ...head, name: " Packing " }])[0].name).toBe(
      "Packing",
    );
    expect(() => checkChargeHeads([head, { ...head, id: "h2" }])).toThrow(
      "two charges",
    );
    expect(() => checkChargeHeads([{ ...head, gstRate: 0 }])).toThrow(
      "pick its GST rate",
    );
    expect(checkChargeHeads([{ ...head, taxType: "exempt" }])[0].gstRate).toBe(
      0,
    );
    expect(() => checkChargeHeads([{ ...head, sac: "12" }])).toThrow("SAC");
  });

  test("snapshots do not copy the head list", () => {
    const db = books();
    const v = sale(db);
    expect("chargeHeads" in (v.snapshot?.settings ?? {})).toBe(false);
  });
});

describe("tax-inclusive rate entry", () => {
  test("stores the rate before GST, to the nearest paisa", () => {
    expect(exclusiveRate(11800, 18)).toBe(10000);
    expect(exclusiveRate(10000, 18)).toBe(8475); // 8474.58
    expect(exclusiveRate(10500, 5)).toBe(10000);
    expect(exclusiveRate(999, 0)).toBe(999);
    expect(inclusiveRate(8475, 18)).toBe(10001); // round trip can be a paisa off
    expect(inclusiveRate(10000, 40)).toBe(14000);
  });
});

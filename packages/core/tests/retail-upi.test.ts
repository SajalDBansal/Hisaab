import { describe, expect, test } from "bun:test";
import type { Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createPurchase,
  createRetailSale,
  createSales,
  updateInvoice,
  updateInvoiceSettings,
} from "../src/mock/db";
import {
  counterKeyOf,
  parseCounterKey,
  peekNumber,
  WALK_IN_PARTY_NAME,
} from "../src/books/base";
import { partyBalance, settledAmounts } from "../src/accounting/bills";
import { postingTotals, voucherPostings } from "../src/accounting/postings";
import { billPayment, qrSvg, upiPayLink } from "../src/print/upi";
import { voucherHtml } from "../src/print/voucherHtml";

const supplier: Party = {
  id: "supplier",
  name: "Supplier",
  type: "supplier",
  phone: "",
  city: "Mathura",
  stateCode: "09",
  gstin: "09BBBBB1111B1ZL",
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
};

function books() {
  const db = blankBooks(
    {
      id: "f",
      name: "Shree Traders",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  db.parties = [supplier];
  db.ledgers.push({
    id: "hdfc",
    name: "HDFC Bank",
    kind: "bank",
    shortName: "HDFC",
    openingBalance: 0,
  } as (typeof db.ledgers)[number]);
  db.items = [
    {
      id: "soap",
      name: "Soap",
      code: "8901",
      hsn: "3401",
      group: "",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: 2000,
      salePrice: 3000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  createPurchase(db, {
    date: "2026-10-01",
    partyId: "supplier",
    lines: [{ itemId: "soap", qty: 10, rate: 2000, gstRate: 18 }],
    charges: [],
  });
  createPurchase(db, {
    date: "2026-10-02",
    partyId: "supplier",
    lines: [{ itemId: "soap", qty: 10, rate: 2500, gstRate: 18 }],
    charges: [],
  });
  return db;
}

const retail = (db: ReturnType<typeof books>, qty = 2, mode = "cash") =>
  createRetailSale(db, {
    date: "2026-10-26",
    lines: [{ itemId: "soap", qty, rate: 3000, gstRate: 18 }],
    buyer: { name: "  Ravi ", phone: "98765 43210" },
    paidBy: {
      mode: mode as "cash",
      ledgerId: mode === "cash" ? "cash" : "hdfc",
    },
  });

describe("retail bills (T02)", () => {
  test("a walk-in sale in its own series, paid in full to the cash customer", () => {
    const db = books();
    const [bill] = retail(db);
    expect(bill!.number).toBe("RI/26-27/0001");
    expect(bill!.type).toBe("sale");
    expect(bill!.docType).toBe("tax-invoice");
    expect(bill!.retail).toEqual({ name: "Ravi", phone: "9876543210" });
    const party = db.parties.find((p) => p.id === bill!.partyId)!;
    expect(party.name).toBe(WALK_IN_PARTY_NAME);
    expect(party.type).toBe("customer");
    expect(party.stateCode).toBe("09");
    expect(bill!.interState).toBe(false);
    // 2 x ₹30 + 18% = ₹70.80 → ₹71 after round-off
    expect(bill!.amount).toBe(7100);
    expect(settledAmounts(db.vouchers).get(bill!.id)).toBe(7100);
    const receipt = db.vouchers.find((v) => v.type === "receipt")!;
    expect(receipt).toMatchObject({
      amount: 7100,
      mode: "cash",
      ledgerId: "cash",
      partyId: party.id,
    });
    expect(partyBalance(party, db.vouchers)).toBe(0);
    // Stock oldest first, postings balanced like any sale
    expect(bill!.lines!.map((l) => l.stockCost)).toEqual([4000]); // 2 x ₹20, first lot
    expect(postingTotals(voucherPostings(bill!)).balanced).toBe(true);
  });

  test("later bills reuse the cash customer; ordinary sales keep SI", () => {
    const db = books();
    const [a] = retail(db);
    const [b] = retail(db, 1, "upi");
    expect(b!.number).toBe("RI/26-27/0002");
    expect(b!.partyId).toBe(a!.partyId);
    expect(
      db.parties.filter((p) => p.name === WALK_IN_PARTY_NAME),
    ).toHaveLength(1);
    expect(
      db.vouchers.filter((v) => v.type === "receipt").at(-1),
    ).toMatchObject({
      mode: "upi",
      ledgerId: "hdfc",
    });
    const [sale] = createSales(db, {
      date: "2026-10-26",
      partyId: a!.partyId!,
      lines: [{ itemId: "soap", qty: 1, rate: 3000, gstRate: 18 }],
      charges: [],
    });
    expect(sale!.number).toBe("SI/26-27/0001");
    expect(sale!.retail).toBeUndefined();
    expect(peekNumber(db, "sale", "2026-10-26", "retail")).toBe(
      "RI/26-27/0003",
    );
  });

  test("a supplier named Cash customer blocks retail bills", () => {
    const db = books();
    db.parties.push({ ...supplier, id: "s2", name: "cash customer" });
    expect(() => retail(db)).toThrow(/Rename it/);
  });

  test("an edit keeps a retail bill's paid total", () => {
    const db = books();
    const [bill] = retail(db);
    expect(() =>
      updateInvoice(
        db,
        bill!.id,
        {
          date: bill!.date,
          partyId: bill!.partyId!,
          lines: [{ itemId: "soap", qty: 3, rate: 3000, gstRate: 18 }],
          charges: [],
        },
        new Date().toISOString(),
      ),
    ).toThrow(/retail bill was paid/);
  });

  test("retail prefix and UPI QR settings are checked", () => {
    const db = books();
    expect(() => updateInvoiceSettings(db, { retailPrefix: "SI" })).toThrow(
      /must differ/,
    );
    expect(() =>
      updateInvoiceSettings(db, { retailPrefix: "toolong" }),
    ).toThrow(/1–4/);
    expect(() =>
      updateInvoiceSettings(db, {
        upiQr: { upiId: "not a vpa", payeeName: "Shop" },
      }),
    ).toThrow(/UPI id/);
    const saved = updateInvoiceSettings(db, {
      retailPrefix: "CASH",
      retailPaper: "58",
      upiQr: { upiId: " shop@okhdfc ", payeeName: " Shree  Traders " },
    });
    expect(saved.upiQr).toEqual({
      upiId: "shop@okhdfc",
      payeeName: "Shree Traders",
    });
    expect(retail(db)[0]!.number).toBe("CASH/26-27/0001");
  });

  test("counter keys round-trip through stored prefixes", () => {
    const settings = {
      prefixes: { sale: "SI", receipt: "RC" } as never,
      billOfSupplyPrefix: "BS",
      retailPrefix: "RI",
    };
    for (const key of [
      "sale:26-27",
      "sale-bos:26-27",
      "sale-nongst:26-27",
      "sale-retail:26-27",
      "sale-nongst-retail:all",
      "credit-note-nongst:26-27",
    ]) {
      const { type, series, year } = parseCounterKey(key);
      const prefix =
        series === "retail"
          ? "RI"
          : series === "nongst-retail"
            ? "NRI"
            : series === "bos"
              ? "BS"
              : series === "nongst"
                ? `N${type === "sale" ? "SI" : "CN"}`
                : "SI";
      const s = { ...settings, prefixes: { sale: "SI", "credit-note": "CN" } };
      expect(counterKeyOf(s as never, type, prefix, year)).toBe(key);
    }
    expect(counterKeyOf(settings, "sale", "OLD", "26-27")).toBeNull();
  });
});

describe("UPI QR on bills (T18)", () => {
  const upi = { upiId: "shop@okhdfc", payeeName: "Shree Traders" };

  test("deep link carries the amount with paise and the bill number", () => {
    expect(upiPayLink(upi, 123405, "SI/26-27/0001")).toBe(
      "upi://pay?pa=shop%40okhdfc&pn=Shree%20Traders&am=1234.05&tn=SI%2F26-27%2F0001&cu=INR",
    );
    const svg = qrSvg(upiPayLink(upi, 100, "X"), 120);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="120"');
  });

  test("a sale with an amount due prints the QR; a paid retail bill does not", () => {
    const db = books();
    db.invoiceSettings.upiQr = upi;
    const [sale] = createSales(db, {
      date: "2026-10-26",
      partyId: retail(db)[0]!.partyId!,
      lines: [{ itemId: "soap", qty: 1, rate: 3000, gstRate: 18 }],
      charges: [],
      paidNow: { amount: 1000, mode: "cash", ledgerId: "cash" },
    });
    const print = (v: typeof sale, layout?: "compact" | "compact-58") =>
      voucherHtml({
        firm: db.firm,
        voucher: v!,
        party: db.parties.find((p) => p.id === v!.partyId),
        items: db.items,
        settings: db.invoiceSettings,
        layout,
        payment: billPayment(db.vouchers, v!),
      }).html;
    const html = print(sale);
    expect(html).toContain('aria-label="UPI QR code"');
    expect(html).toContain("Scan to pay ₹25.00");
    expect(html).toContain("Received (Cash)");
    expect(html).toContain("Balance due");
    // Thermal layouts carry it too, with the roll width for the PDF
    const narrow = print(sale, "compact-58");
    expect(narrow).toContain('content="58mm"');
    expect(narrow).toContain("UPI QR code");
    expect(print(sale, "compact")).toContain('content="80mm"');

    const paid = db.vouchers.find((v) => v.retail)!;
    const receipt = print(paid, "compact-58");
    expect(receipt).not.toContain("UPI QR code");
    expect(receipt).toContain("Received (Cash)");
    expect(receipt).toContain("Ravi");
    expect(receipt).not.toContain("Due date");

    db.invoiceSettings.upiQr = null;
    expect(print(sale)).not.toContain("UPI QR code");
  });
});

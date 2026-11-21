import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  cancelVoucher,
  createOrder,
  createPurchase,
  createSale,
} from "../src/mock/db";
import { convertBlocker } from "../src/books/orders";
import { CONVERTS_TO, orderStatus } from "../src/accounting/orders";
import { voucherPostings } from "../src/accounting/postings";
import { printTitle, voucherHtml } from "../src/print/voucherHtml";
import { buildReport } from "../src/reporting";
import { canVoucher, registerRoles, type RoleDefinition } from "../src/roles";

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
  db.invoiceSettings.bankAccount = {
    accountName: "F",
    accountNumber: "1234567890",
    ifsc: "SBIN0000001",
  };
  db.invoiceSettings.showBankDetails = true;
  return db;
}

const line: InvoiceLine = { itemId: "item", qty: 2, rate: 20000, gstRate: 18 };
const order = (db: ReturnType<typeof books>, sourceId?: string) =>
  createOrder(db, "proforma", {
    partyId: "customer",
    date: "2026-10-20",
    lines: [line],
    sourceId,
  });

describe("proforma invoice (T01)", () => {
  test("is numbered in its own series and never touches the books", () => {
    const db = books();
    const first = order(db);
    const second = order(db);
    expect(first.number).toMatch(/^PF\/26-27\/0+1$/);
    expect(second.number).toMatch(/^PF\/26-27\/0+2$/);
    expect(first.amount).toBe(47200);
    expect(first.validUntil).toBeUndefined();
    expect(voucherPostings(first)).toEqual([]);
    const tb = buildReport(db, {
      report: "trial-balance",
      from: "2026-04-01",
      to: "2026-10-26",
      includeNarration: false,
      includeZeroBalances: false,
    });
    expect(JSON.stringify(tb.sections)).not.toContain("47200");
  });

  test("is for customers only", () => {
    const db = books();
    expect(() =>
      createOrder(db, "proforma", {
        partyId: "supplier",
        date: "2026-10-20",
        lines: [line],
      }),
    ).toThrow("Pick a customer.");
  });

  test("an estimate becomes a proforma, and the proforma becomes the sale", () => {
    const db = books();
    createPurchase(db, {
      partyId: "supplier",
      date: "2026-10-01",
      lines: [{ ...line, rate: 10000 }],
      charges: [],
      supplierInvoiceNo: "S-1",
    });
    expect(CONVERTS_TO.estimate).toContain("proforma");
    expect(CONVERTS_TO.proforma).toEqual(["sale"]);
    const estimate = createOrder(db, "estimate", {
      partyId: "customer",
      date: "2026-10-18",
      lines: [line],
    });
    expect(convertBlocker(db, estimate, "proforma")).toBeNull();
    const proforma = order(db, estimate.id);
    expect(db.vouchers.find((v) => v.id === estimate.id)?.convertedToId).toBe(
      proforma.id,
    );
    expect(convertBlocker(db, proforma, "sales-order")).toBe(
      "It can't be turned into that.",
    );
    expect(convertBlocker(db, proforma, "sale")).toBeNull();
    const sale = createSale(db, {
      partyId: "customer",
      date: "2026-10-26",
      lines: [line],
      charges: [],
      sourceId: proforma.id,
    });
    const after = db.vouchers.find((v) => v.id === proforma.id)!;
    expect(after.convertedToId).toBe(sale.id);
    expect(orderStatus(after, "2026-10-26")).toBe("converted");
    expect(convertBlocker(db, after, "sale")).toContain(sale.number);
  });

  test("prints as a proforma, not a tax invoice, with bank details", () => {
    const db = books();
    const v = order(db);
    expect(printTitle(v)).toBe("PROFORMA INVOICE");
    const html = voucherHtml({
      firm: db.firm,
      voucher: v,
      party: db.parties[0],
      items: db.items,
      settings: db.invoiceSettings,
    }).html;
    expect(html).toContain("PROFORMA INVOICE");
    expect(html).toContain("Proforma no.");
    expect(html).toContain("This is not a tax invoice.");
    expect(html).toContain("1234567890");
    expect(html).not.toContain("TAX INVOICE");
  });

  test("has its own register with status", () => {
    const db = books();
    const open = order(db);
    const cancelled = order(db);
    cancelVoucher(db, cancelled.id, "Customer dropped it");
    const doc = buildReport(db, {
      report: "proformas-register",
      from: "2026-04-01",
      to: "2026-10-26",
      includeNarration: false,
      includeZeroBalances: false,
    });
    const text = JSON.stringify(doc.sections);
    expect(text).toContain(open.number);
    expect(text).toContain("Open");
    expect(text).toContain("Cancelled");
    expect(doc.title).toStartWith("Proforma invoices");
  });

  test("built-in sales roles get it; a custom role only when granted", () => {
    expect(canVoucher("owner", "proforma", "create")).toBe(true);
    expect(canVoucher("sales", "proforma", "create")).toBe(true);
    const role = (vouchers: RoleDefinition["vouchers"]): RoleDefinition => ({
      id: `r_${crypto.randomUUID()}`,
      name: "Counter",
      permissions: ["sales"],
      vouchers,
      flags: {
        hidePurchaseRate: false,
        viewProfitMargin: false,
        ownRecordsOnly: false,
        viewAudit: false,
        restoreCancelled: false,
      },
    });
    const older = role({ estimate: ["view", "create"] });
    const granted = role({ proforma: ["view", "create"] });
    registerRoles([older, granted]);
    expect(canVoucher(older.id, "proforma", "view")).toBe(false);
    expect(canVoucher(granted.id, "proforma", "create")).toBe(true);
  });
});

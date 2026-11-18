import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  cancelVoucher,
  createNote,
  createOrder,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
} from "../src/mock/db";
import { buildReport, type ReportRequest } from "../src/reporting";
import { periodProfitAndLoss } from "../src/accounting/generalLedger";
import { calcInvoice } from "../src/accounting/invoice";
import { crc32, reportXlsx } from "../src/reporting/xlsx";

const party = (
  id: string,
  type: Party["type"],
  extra: Partial<Party> = {},
): Party => ({
  id,
  name: id,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 30,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  ...(type === "supplier" ? { gstin: "09BBBBB1111B1ZL" } : {}),
  ...extra,
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
    party("Asha", "customer"),
    party("Bina", "customer"),
    party("Chand", "customer"),
    party("Supplier A", "supplier"),
    party("Supplier B", "supplier", { gstin: "09CCCCC2222C1ZM" }),
  ];
  db.items = [
    {
      id: "rice",
      name: "Rice",
      code: "",
      hsn: "1006",
      group: "",
      taxType: "taxable",
      gstRate: 5,
      unit: "Kg",
      purchasePrice: 4000,
      salePrice: 5000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  return db;
}
const line = (qty: number, rate: number): InvoiceLine => ({
  itemId: "rice",
  qty,
  rate,
  gstRate: 5,
});
const request = (
  report: ReportRequest["report"],
  extra: Partial<ReportRequest> = {},
): ReportRequest => ({
  report,
  from: "2026-04-01",
  to: "2026-10-26",
  includeNarration: false,
  includeZeroBalances: false,
  ...extra,
});
const rows = (doc: ReturnType<typeof buildReport>, section = 0) =>
  doc.sections[section].rows.filter((r) => !r.total).map((r) => r.cells);

describe("ITC at risk (T26)", () => {
  test("unpaid GST bills: reverse at 180 days, warn from 150, in proportion to what is unpaid", () => {
    const db = books();
    const old = createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(100, 4000)],
    });
    const nearly = createPurchase(db, {
      date: "2026-05-20",
      partyId: "Supplier A",
      lines: [line(10, 4000)],
    });
    createPurchase(db, {
      date: "2026-08-01",
      partyId: "Supplier A",
      lines: [line(10, 4000)],
    }); // too recent
    // Half of the old bill paid
    createPayment(db, {
      date: "2026-05-01",
      partyId: "Supplier A",
      amount: old.amount / 2,
      mode: "cash",
      ledgerId: "cash",
      allocations: [{ voucherId: old.id, amount: old.amount / 2 }],
    });
    const doc = buildReport(db, request("itc-at-risk"));
    const found = rows(doc);
    expect(found.map((r) => r[0])).toEqual(["Reverse now", "Due soon"]);
    const tax = (v: typeof old) =>
      calcInvoice({ lines: v.lines ?? [], interState: false }).tax;
    expect(found[0][1]).toBe(old.number);
    expect(found[0][10]).toBe(Math.round(tax(old) / 2));
    expect(found[1][1]).toBe(nearly.number);
    expect(found[1][10]).toBe(tax(nearly));
  });
});

describe("interest on overdue invoices (T49)", () => {
  test("simple interest from the due date at the chosen rate", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(100, 4000)],
    });
    const sale = createSale(db, {
      date: "2026-08-01",
      partyId: "Asha",
      lines: [line(10, 10000)],
    });
    const doc = buildReport(
      db,
      request("interest-calculator", { interestRate: 12 }),
    );
    const [row] = rows(doc);
    const overdue = Number(row[4]); // due 31 Aug → 26 Oct = 56 days
    expect(overdue).toBe(56);
    expect(row[6]).toBe(Math.round((sale.amount * 12 * overdue) / 36_500));
    expect(doc.sections[0].title).toContain("12%");
    expect(() =>
      buildReport(db, request("interest-calculator", { interestRate: 99 })),
    ).toThrow();
    expect(() =>
      buildReport(db, request("sales-register", { interestRate: 10 })),
    ).toThrow();
  });
});

describe("customers and suppliers (T56)", () => {
  test("new, regular and lost customers; ranking nets off returns", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(500, 4000)],
    });
    createSale(db, {
      date: "2026-04-05",
      partyId: "Asha",
      lines: [line(10, 5000)],
    }); // before period → regular/lost
    createSale(db, {
      date: "2026-10-20",
      partyId: "Asha",
      lines: [line(10, 5000)],
    });
    createSale(db, {
      date: "2026-04-10",
      partyId: "Bina",
      lines: [line(50, 5000)],
    }); // only old sale → lost
    const chand = createSale(db, {
      date: "2026-10-01",
      partyId: "Chand",
      lines: [line(40, 5000)],
    });
    createNote(db, "credit-note", {
      againstId: chand.id,
      date: "2026-10-05",
      reason: "Damaged",
      lines: [{ index: 0, qty: 30 }],
    });
    const tracking = rows(
      buildReport(db, request("customer-tracking", { from: "2026-09-01" })),
    );
    const status = Object.fromEntries(tracking.map((r) => [r[0], r[1]]));
    expect(status).toEqual({ Chand: "New", Asha: "Regular", Bina: "Lost" });

    const top = rows(buildReport(db, request("top-customers")));
    // Bina 50 kg > Asha 20 kg > Chand 10 kg net of returns
    expect(top.map((r) => r[1])).toEqual(["Bina", "Asha", "Chand"]);
    expect(top.reduce((s, r) => s + Number(r[4]), 0)).toBeCloseTo(100, 0);
  });
});

describe("trading reports (T50)", () => {
  test("by item and by party net returns; tax summary is output less input", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier B",
      lines: [line(100, 4000)],
    });
    const sale = createSale(db, {
      date: "2026-05-01",
      partyId: "Asha",
      lines: [line(30, 5000)],
    });
    createNote(db, "credit-note", {
      againstId: sale.id,
      date: "2026-05-05",
      reason: "Returned",
      lines: [{ index: 0, qty: 10 }],
    });
    const byItem = rows(buildReport(db, request("sales-by-item")));
    expect(byItem).toHaveLength(1);
    expect(byItem[0][3]).toBe(20);
    expect(byItem[0][4]).toBe(20 * 5000);

    const byParty = rows(buildReport(db, request("purchases-by-party")));
    expect(byParty[0][0]).toBe("Supplier B");
    expect(byParty[0][1]).toBe("09CCCCC2222C1ZM");

    const summary = rows(buildReport(db, request("tax-summary")));
    const five = summary.find((r) => r[0] === "5%")!;
    expect(five[2]).toBe(Math.round(20 * 5000 * 0.05)); // output, after return
    expect(five[4]).toBe(Math.round(100 * 4000 * 0.05)); // input
    expect(five[5]).toBe(Number(five[2]) - Number(five[4]));

    const gstr2 = buildReport(db, request("gstr2"));
    expect(gstr2.sections.map((s) => s.title)).toHaveLength(3);
    expect(rows(gstr2)[0][0]).toBe("09CCCCC2222C1ZM");
  });

  test("order registers show each order's status", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(100, 4000)],
    });
    const open = createOrder(db, "sales-order", {
      date: "2026-06-01",
      partyId: "Asha",
      lines: [line(5, 5000)],
    });
    const done = createOrder(db, "sales-order", {
      date: "2026-06-02",
      partyId: "Bina",
      lines: [line(5, 5000)],
    });
    createSale(db, {
      date: "2026-06-03",
      partyId: "Bina",
      lines: [line(5, 5000)],
      sourceId: done.id,
    });
    const gone = createOrder(db, "sales-order", {
      date: "2026-06-04",
      partyId: "Chand",
      lines: [line(5, 5000)],
    });
    cancelVoucher(db, gone.id, "No longer needed", "2026-06-05T00:00:00Z");
    const register = rows(buildReport(db, request("sales-orders-register")));
    expect(register.map((r) => [r[1], r[3]])).toEqual([
      [open.number, "Open"],
      [done.number, "Converted"],
      [gone.number, "Cancelled"],
    ]);
    expect(register[2][5]).toBe(0); // cancelled orders carry no amount
  });
});

describe("T-format final accounts (T51)", () => {
  test("both sides balance and the net profit matches the P&L", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(100, 4000)],
    });
    const sale = createSale(db, {
      date: "2026-05-01",
      partyId: "Asha",
      lines: [line(60, 6000)],
    });
    createReceipt(db, {
      date: "2026-05-10",
      partyId: "Asha",
      amount: sale.amount,
      mode: "cash",
      ledgerId: "cash",
      allocations: [{ voucherId: sale.id, amount: sale.amount }],
    });
    const doc = buildReport(db, request("profit-loss-t"));
    for (const section of doc.sections) {
      const total = section.rows.find((r) => r.total)!.cells;
      expect(total[1]).toBe(total[3]);
    }
    const pl = periodProfitAndLoss(db, "2026-04-01", "2026-10-26");
    const netRow = doc.sections[1].rows.find(
      (r) => r.cells[0] === "Net profit",
    )!;
    expect(netRow.cells[1]).toBe(pl.netProfit);

    const bs = buildReport(db, request("balance-sheet-t"));
    const total = bs.sections[0].rows.find((r) => r.total)!.cells;
    expect(total[1]).toBe(total[3]);
  });
});

describe("Excel export (T54)", () => {
  test("a valid zip whose parts have the right checksums and real numbers for money", () => {
    const db = books();
    createPurchase(db, {
      date: "2026-04-02",
      partyId: "Supplier A",
      lines: [line(100, 4000)],
    });
    createSale(db, {
      date: "2026-05-01",
      partyId: "Asha",
      lines: [line(3, 5000)],
    });
    const doc = buildReport(db, request("sales-by-party"));
    const bytes = reportXlsx(doc);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const names: string[] = [];
    const decoder = new TextDecoder();
    let sheet = "";
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const crc = view.getUint32(at + 16, true);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const name = decoder.decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      );
      const localName = view.getUint16(local + 26, true);
      const data = bytes.subarray(
        local + 30 + localName,
        local + 30 + localName + size,
      );
      expect(crc32(data)).toBe(crc);
      names.push(name);
      if (name === "xl/worksheets/sheet1.xml") sheet = decoder.decode(data);
      at += 46 + nameLength;
    }
    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("xl/workbook.xml");
    // Money as numbers in rupees (3 × ₹50 = ₹150 taxable), styled with the money format
    expect(sheet).toContain('<c r="D');
    expect(sheet).toMatch(/s="1"><v>150<\/v>/);
    expect(sheet).not.toContain("<f>");
  });

  test("text that looks like a formula or markup stays text", () => {
    const doc = {
      title: "T",
      firmName: "A & B <Traders>",
      gstin: "",
      address: "",
      period: "",
      generatedAt: "now",
      fileName: "t",
      notes: [],
      sections: [
        {
          title: "S",
          columns: [{ label: "Name", kind: "text" as const }],
          rows: [{ cells: ['=HYPERLINK("x")'] }],
        },
      ],
    };
    const text = new TextDecoder().decode(reportXlsx(doc));
    expect(text).toContain("A &amp; B &lt;Traders&gt;");
    expect(text).toContain('t="inlineStr"');
    expect(text).not.toContain("<f>");
  });
});

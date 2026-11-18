import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createParty,
  createPayment,
  createPurchase,
  updateFirm,
  updateParty,
} from "../src/mock/db";
import { buildReport, type ReportRequest } from "../src/reporting";
import {
  addCalendarMonths,
  DEFAULT_MSME_INTEREST_RATE,
  msmeCovered,
  msmeInterest,
  msmePayBy,
} from "../src/accounting/msme";
import { checkFirmStatutory, checkMsme } from "../src/businessProfile";
import { checkParty } from "../src/validation";
import { voucherHtml } from "../src/print/voucherHtml";

describe("MSME rules (MSMED Act s.15-16)", () => {
  test("pay by: the agreed period capped at 45 days; 15 days when none agreed", () => {
    expect(msmePayBy("2026-07-01", "2026-07-31")).toBe("2026-07-31");
    expect(msmePayBy("2026-07-01", "2026-09-29")).toBe("2026-08-15");
    expect(msmePayBy("2026-07-01", "2026-07-01")).toBe("2026-07-16");
    expect(msmePayBy("2026-07-01")).toBe("2026-07-16");
  });

  test("calendar months clamp to the month's end", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addCalendarMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  test("s.16 interest: compound with monthly rests, leftover days simple", () => {
    // ₹1,00,000 late from 15 Aug to 26 Oct: two whole months, then 11 days.
    const r = msmeInterest(1_00_000_00, "2026-08-15", "2026-10-26", 18);
    expect(r.months).toBe(2);
    expect(r.days).toBe(11);
    const expected = Math.round(
      1_00_000_00 * (1.015 * 1.015) * (1 + (18 * 11) / 36_500) - 1_00_000_00,
    );
    expect(r.interest).toBe(expected);
    // ₹3,581.36: more than simple interest for the same 72 days (₹3,550.68).
    expect(r.interest).toBe(3_581_36);
    expect(r.interest).toBeGreaterThan(
      Math.round((1_00_000_00 * 18 * 72) / 36_500),
    );
    // Exactly one month: 1.5%.
    expect(
      msmeInterest(1_00_000_00, "2026-08-15", "2026-09-15", 18).interest,
    ).toBe(1_500_00);
    // Not late yet, or nothing pending: no interest.
    expect(
      msmeInterest(1_00_000_00, "2026-08-15", "2026-08-15", 18).interest,
    ).toBe(0);
    expect(msmeInterest(0, "2026-08-15", "2026-10-26", 18).interest).toBe(0);
  });

  test("only micro and small enterprises are covered", () => {
    expect(msmeCovered("micro")).toBe(true);
    expect(msmeCovered("small")).toBe(true);
    expect(msmeCovered("medium")).toBe(false);
    expect(msmeCovered(undefined)).toBe(false);
  });
});

describe("business profile checks (T61)", () => {
  test("statutory numbers are checked only when typed", () => {
    expect(checkFirmStatutory({})).toEqual({});
    expect(
      checkFirmStatutory({
        cin: "U52100UP2015PTC012345",
        tan: "DELA12345B",
        udyamNumber: "UDYAM-UP-09-0012345",
        msmeType: "micro",
        iec: "AAAAA0000A",
        fssai: "12345678901234",
        website: "www.example.com",
        ownershipType: "private-limited",
        businessType: "wholesale",
      }),
    ).toEqual({});
    expect(checkFirmStatutory({ cin: "AAB-1234" })).toEqual({});
    const bad = checkFirmStatutory({
      cin: "123",
      tan: "ABC",
      fssai: "12",
      iec: "x",
      website: "not a site",
      udyamNumber: "UDYAM-1",
      msmeType: "micro",
    });
    expect(Object.keys(bad).sort()).toEqual(
      ["cin", "fssai", "iec", "tan", "udyamNumber", "website"].sort(),
    );
    expect(checkMsme({ udyamNumber: "UDYAM-UP-09-0012345" }).udyamNumber).toBe(
      "Pick micro, small or medium for this Udyam number.",
    );
  });

  test("demo books: firm details save, clear and print on bills", () => {
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
    updateFirm(db, {
      fssai: "12345678901234",
      drugLicence: "20B/UP/123",
      cin: "u52100up2015ptc012345",
      udyamNumber: "udyam-up-09-0012345",
      msmeType: "micro",
      website: "www.f.in",
    });
    expect(db.firm.cin).toBe("U52100UP2015PTC012345");
    expect(db.firm.udyamNumber).toBe("UDYAM-UP-09-0012345");
    expect(() => updateFirm(db, { tan: "nope" })).toThrow(/TAN/);
    // Clearing the class with the Udyam number still there is refused.
    expect(() => updateFirm(db, { msmeType: "" })).toThrow(/Udyam/);
    updateFirm(db, { website: "" });
    expect("website" in db.firm).toBe(false);

    db.parties = [supplier("S", {})];
    db.items = [rice];
    const bill = createPurchase(db, {
      date: "2026-10-01",
      partyId: "S",
      lines: [line(1, 100_00)],
    });
    const { html } = voucherHtml({
      voucher: bill,
      firm: db.firm,
      party: db.parties[0],
      items: db.items,
      settings: db.invoiceSettings,
    } as never);
    expect(html).toContain("FSSAI Lic. No. 12345678901234");
    expect(html).toContain("D.L. No. 20B/UP/123");
    expect(html).toContain("CIN U52100UP2015PTC012345");
    expect(html).toContain("UDYAM-UP-09-0012345 (Micro)");
  });
});

const line = (qty: number, rate: number): InvoiceLine => ({
  itemId: "rice",
  qty,
  rate,
  gstRate: 5,
});
const rice = {
  id: "rice",
  name: "Rice",
  code: "",
  hsn: "1006",
  group: "",
  taxType: "taxable" as const,
  gstRate: 5,
  unit: "Kg",
  purchasePrice: 4000,
  salePrice: 5000,
  mrp: 0,
  reorderLevel: 0,
  openingStock: 0,
};
const supplier = (id: string, extra: Partial<Party>): Party => ({
  id,
  name: id,
  type: "supplier",
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 30,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  gstin: "09BBBBB1111B1ZL",
  ...extra,
});

describe("MSME supplier flag (T30)", () => {
  test("kept for suppliers only; left out keeps it, null clears it", () => {
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
    const base = {
      name: "Oil Mill",
      type: "supplier" as const,
      phone: "",
      city: "",
      stateCode: "09",
      creditDays: 30,
      creditLimit: 0,
      openingBalance: 0,
    };
    const p = createParty(
      db,
      { ...base, msmeType: "small", udyamNumber: " udyam-up-09-0012345 " },
      "2026-10-26",
    );
    expect(p.msmeType).toBe("small");
    expect(p.udyamNumber).toBe("UDYAM-UP-09-0012345");
    updateParty(db, p.id, { ...base, city: "Agra" });
    expect(p.msmeType).toBe("small");
    updateParty(db, p.id, { ...base, msmeType: null });
    expect(p.msmeType).toBeUndefined();
    expect(p.udyamNumber).toBeUndefined();
    const c = createParty(
      db,
      { ...base, name: "Cust", type: "customer", msmeType: "micro" },
      "2026-10-26",
    );
    expect(c.msmeType).toBeUndefined();
    expect(
      checkParty({ ...base, msmeType: "micro", udyamNumber: "UDYAM" }, [])
        .udyamNumber,
    ).toContain("UDYAM-UP-09-0012345");
  });
});

describe("MSME payables report (T30)", () => {
  const request = (extra: Partial<ReportRequest> = {}): ReportRequest => ({
    report: "msme-payables",
    from: "2026-04-01",
    to: "2026-10-26",
    includeNarration: false,
    includeZeroBalances: false,
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
    db.items = [rice];
    db.parties = [
      supplier("Micro M", { msmeType: "micro", creditDays: 60 }),
      supplier("Small S", { msmeType: "small", creditDays: 0 }),
      supplier("Medium D", { msmeType: "medium" }),
      supplier("Plain P", {}),
    ];
    return db;
  }

  test("unpaid bills of micro and small suppliers, with pay-by date and s.16 interest", () => {
    const db = books();
    const late = createPurchase(db, {
      date: "2026-07-01",
      partyId: "Micro M",
      lines: [line(100, 1000_00)],
    });
    const soon = createPurchase(db, {
      date: "2026-10-15",
      partyId: "Small S",
      lines: [line(1, 100_00)],
    });
    createPurchase(db, {
      date: "2026-04-10",
      partyId: "Medium D",
      lines: [line(10, 1000_00)],
    });
    createPurchase(db, {
      date: "2026-04-10",
      partyId: "Plain P",
      lines: [line(10, 1000_00)],
    });
    // ₹10,000 paid on account, not against a bill: set against the oldest bill.
    createPayment(db, {
      date: "2026-09-01",
      partyId: "Micro M",
      amount: 10_000_00,
      mode: "cash",
      ledgerId: "cash",
      allocations: [],
    });

    const doc = buildReport(db, request({ interestRate: 18 }));
    const found = doc.sections[0].rows
      .filter((r) => !r.total)
      .map((r) => r.cells);
    expect(found.map((r) => r[1])).toEqual([late.number, soon.number]);
    const [first, second] = found;
    expect(first[0]).toBe("Overdue");
    expect(first[4]).toBe("Micro");
    expect(first[6]).toBe("15-08-2026"); // 60 agreed days capped at 45
    expect(first[7]).toBe(72);
    const pending = late.amount - 10_000_00;
    expect(first[8]).toBe(pending);
    expect(first[9]).toBe(
      msmeInterest(pending, "2026-08-15", "2026-10-26", 18).interest,
    );
    expect(first[10]).toBe(pending + Number(first[9]));
    expect(second[0]).toBe("Due soon"); // no credit agreed: 15 days, by 30 Oct
    expect(second[6]).toBe("30-10-2026");
    expect(second[7]).toBe(0);
    expect(second[9]).toBe(0);
    expect(doc.sections[0].title).toContain("18%");
    expect(doc.notes.join(" ")).toContain("43B(h)");

    // Default rate, party filter, and the rate stays limited to rate reports.
    expect(buildReport(db, request()).sections[0].title).toContain(
      `${DEFAULT_MSME_INTEREST_RATE}%`,
    );
    const one = buildReport(db, request({ partyId: "Small S" }));
    expect(one.sections[0].rows.filter((r) => !r.total)).toHaveLength(1);
    expect(() => buildReport(db, request({ interestRate: 61 }))).toThrow();
    expect(() =>
      buildReport(db, { ...request(), report: "payables", interestRate: 10 }),
    ).toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { blankBooks } from "../src/mock/seed";
import { updateInvoiceSettings } from "../src/mock/db";
import { peekNumber, takeNumber } from "../src/books/base";

function books() {
  return blankBooks(
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
}

describe("voucher numbering rules (doc 37, T08)", () => {
  test("default format is unchanged: prefix, year, four digits, yearly restart", () => {
    const db = books();
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/26-27/0001");
    expect(takeNumber(db, "sale", "2026-10-27")).toBe("SI/26-27/0002");
    expect(takeNumber(db, "sale", "2027-04-01")).toBe("SI/27-28/0001");
    expect(db.counters).toEqual({ "sale:26-27": 2, "sale:27-28": 1 });
  });

  test("starting number and digits apply per type", () => {
    const db = books();
    updateInvoiceSettings(db, {
      numbering: { sale: { start: 501, digits: 6, showYear: true } },
    });
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/26-27/000501");
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/26-27/000502");
    // Other types keep the default.
    expect(takeNumber(db, "purchase", "2026-10-26")).toBe("PI/26-27/0001");
  });

  test("raising the start skips ahead; lowering it never reuses numbers", () => {
    const db = books();
    takeNumber(db, "sale", "2026-10-26");
    takeNumber(db, "sale", "2026-10-26");
    updateInvoiceSettings(db, {
      numbering: { sale: { start: 100, digits: 4, showYear: true } },
    });
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/26-27/0100");
    updateInvoiceSettings(db, {
      numbering: { sale: { start: 1, digits: 4, showYear: true } },
    });
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/26-27/0101");
  });

  test("without the year there is one running sequence across years", () => {
    const db = books();
    updateInvoiceSettings(db, {
      numbering: { sale: { start: 1, digits: 3, showYear: false } },
    });
    expect(takeNumber(db, "sale", "2026-10-26")).toBe("SI/001");
    expect(takeNumber(db, "sale", "2027-04-01")).toBe("SI/002");
    expect(db.counters["sale:all"]).toBe(2);
  });

  test("non-GST and bill-of-supply series follow the type's rule", () => {
    const db = books();
    updateInvoiceSettings(db, {
      numbering: { sale: { start: 1, digits: 2, showYear: false } },
    });
    expect(peekNumber(db, "sale", "2026-10-26", "nongst")).toBe("NSI/01");
    expect(peekNumber(db, "sale", "2026-10-26", "bos")).toBe("BS/01");
  });

  test("invalid rules are refused", () => {
    const db = books();
    const bad =
      (rule: { start: number; digits: number; showYear: boolean }) => () =>
        updateInvoiceSettings(db, { numbering: { sale: rule } });
    expect(bad({ start: 0, digits: 4, showYear: true })).toThrow();
    expect(bad({ start: 1, digits: 9, showYear: true })).toThrow();
    expect(bad({ start: 1.5, digits: 4, showYear: true })).toThrow();
    expect(() =>
      updateInvoiceSettings(db, {
        numbering: {
          bogus: { start: 1, digits: 4, showYear: true },
        } as never,
      }),
    ).toThrow("Unknown voucher type");
  });
});

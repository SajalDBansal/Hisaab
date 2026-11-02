import { describe, expect, test } from "bun:test";
import type { Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import { createExpense } from "../src/mock/db";
import { postingTotals, voucherPostings } from "../src/accounting/postings";
import { gstMonth } from "../src/accounting/gst";
import { UNREGISTERED_SUPPLIER_GST_MESSAGE } from "../src/accounting/taxType";

const supplier = (gstin?: string, stateCode = "09"): Party => ({
  id: "s",
  name: "Landlord",
  type: "supplier",
  phone: "",
  city: "Mathura",
  stateCode,
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  gstin,
});

function books(
  gstRegistration: "regular" | "composition" = "regular",
  party = supplier("09BBBBB1111B1ZL"),
) {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration,
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  db.parties = [party];
  return db;
}

const rent = (db: ReturnType<typeof books>) =>
  createExpense(db, {
    date: "2026-10-05",
    expenseHead: "Rent",
    amount: 1,
    mode: "bank",
    ledgerId: "bank",
    gst: { partyId: "s", rate: 18, taxable: 1000000 },
  });

describe("GST on expenses", () => {
  test("the total includes GST and the GST is input credit", () => {
    const v = rent(books());
    expect(v.amount).toBe(1180000);
    const rows = voucherPostings(v, { ledger: "Bank" });
    expect(postingTotals(rows).balanced).toBe(true);
    expect(rows.map((r) => [r.account, r.debit, r.credit])).toEqual([
      ["expense:Rent", 1000000, 0],
      ["input:cgst", 90000, 0],
      ["input:sgst", 90000, 0],
      ["ledger:bank", 0, 1180000],
    ]);
  });

  test("an interstate supplier's GST is IGST", () => {
    const v = rent(books("regular", supplier("27AAPFU0939F1ZV", "27")));
    expect(
      voucherPostings(v).some(
        (r) => r.account === "input:igst" && r.debit === 180000,
      ),
    ).toBe(true);
  });

  test("it counts in the month's input credit and GSTR-3B", () => {
    const db = books();
    rent(db);
    const month = gstMonth(db.vouchers, "2026-10");
    expect(month.input.total).toBe(180000);
    expect(month.creditLeft.total).toBe(180000);
  });

  test("a supplier without GSTIN can't give GST credit", () => {
    expect(() => rent(books("regular", supplier()))).toThrow(
      UNREGISTERED_SUPPLIER_GST_MESSAGE,
    );
  });

  test("only a regular firm can claim it", () => {
    expect(() => rent(books("composition"))).toThrow("Only a regular GST firm");
  });

  test("expenses without GST are unchanged", () => {
    const v = createExpense(books(), {
      date: "2026-10-05",
      expenseHead: "Tea",
      amount: 5000,
      mode: "cash",
      ledgerId: "cash",
    });
    expect(v.amount).toBe(5000);
    expect(voucherPostings(v)).toHaveLength(2);
  });
});

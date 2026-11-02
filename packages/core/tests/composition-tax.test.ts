import { expect, test } from "bun:test";
import type { Voucher } from "../src/types";
import {
  compositionQuarter,
  compositionTaxEntry,
  COMPOSITION_TAX_ACCOUNT,
} from "../src/accounting/gstMode";

const sale = (date: string, taxable: number): Voucher => ({
  id: date,
  type: "sale",
  number: date,
  date,
  status: "posted",
  taxMode: "composition",
  lines: [{ itemId: "i", qty: 1, rate: taxable, gstRate: 0, exactMath: true }],
  amount: taxable,
  createdAt: `${date}T00:00:00Z`,
});
const journal = (date: string, debit: number): Voucher => ({
  id: `j${date}`,
  type: "journal",
  number: "J",
  date,
  status: "posted",
  journalLines: [
    {
      account: COMPOSITION_TAX_ACCOUNT,
      name: "Composition Tax",
      debit,
      credit: 0,
    },
    {
      account: "provision:Composition Tax Payable",
      name: "Payable",
      debit: 0,
      credit: debit,
    },
  ],
  amount: debit,
  createdAt: `${date}T00:00:00Z`,
});

test("a closed quarter proposes its tax as an expense against a payable", () => {
  const q = compositionQuarter([sale("2026-08-10", 1000000)], "2026-09-15");
  expect([q.tax, q.recorded, q.end, q.due]).toEqual([
    10000,
    0,
    "2026-09-30",
    "2026-10-18",
  ]);
  expect(compositionTaxEntry(q)).toEqual({
    date: "2026-09-30",
    narration: "Composition tax (CMP-08) for Jul–Sep 2026",
    lines: [
      {
        account: COMPOSITION_TAX_ACCOUNT,
        name: "Composition Tax",
        debit: 10000,
        credit: 0,
      },
      {
        account: "provision:Composition Tax Payable",
        name: "Composition Tax Payable",
        debit: 0,
        credit: 10000,
      },
    ],
  });
});

test("a recorded quarter needs nothing; changed sales propose the difference", () => {
  const recorded = [sale("2026-08-10", 1000000), journal("2026-09-30", 10000)];
  expect(
    compositionTaxEntry(compositionQuarter(recorded, "2026-09-15")),
  ).toBeNull();
  const more = [...recorded, sale("2026-09-20", 500000)];
  const entry = compositionTaxEntry(compositionQuarter(more, "2026-09-15"))!;
  expect(entry.lines[0]).toMatchObject({
    account: COMPOSITION_TAX_ACCOUNT,
    debit: 5000,
  });
  expect(entry.narration).toContain("adjustment");
});

test("the Jan-Mar quarter ends on 31 March", () => {
  expect(compositionQuarter([], "2027-02-10").end).toBe("2027-03-31");
});

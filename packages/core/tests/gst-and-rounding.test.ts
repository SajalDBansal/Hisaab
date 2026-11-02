import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Voucher } from "../src/types";
import { gstMonth, gstr3b, setOff } from "../src/accounting/gst";
import { calcLine } from "../src/accounting/invoice";
import { mulDivRound } from "../src/money";
import { calcTds, tdsBase } from "../src/accounting/tds";
import { altQtyText } from "../src/accounting/stock";

const heads = (cgst: number, sgst: number, igst: number) => ({
  cgst,
  sgst,
  igst,
});
const cash = (r: ReturnType<typeof setOff>) =>
  r.payable.cgst + r.payable.sgst + r.payable.igst;

describe("GST set-off (Rule 88A)", () => {
  test.each([
    // output, input, expected cash
    [
      "IGST credit covers the SGST gap",
      heads(100, 100, 0),
      heads(100, 0, 100),
      0,
    ],
    [
      "IGST credit covers the CGST gap",
      heads(100, 100, 0),
      heads(0, 100, 100),
      0,
    ],
    [
      "IGST credit split across both gaps",
      heads(100, 100, 0),
      heads(50, 50, 100),
      0,
    ],
    ["IGST first, then intra heads", heads(60, 60, 50), heads(0, 0, 200), 0],
    [
      "CGST and SGST pay IGST after their own heads",
      heads(10, 10, 100),
      heads(60, 60, 0),
      0,
    ],
    [
      "Not enough credit leaves only the true shortfall",
      heads(100, 100, 100),
      heads(20, 0, 50),
      230,
    ],
  ])("%s", (_name, output, input, expected) => {
    expect(cash(setOff(output, input))).toBe(expected);
  });

  test("CGST credit is never used for SGST", () => {
    const r = setOff(heads(0, 100, 0), heads(100, 0, 0));
    expect(r.payable.sgst).toBe(100);
    expect(r.creditLeft.cgst).toBe(100);
  });

  test("IGST credit is used before CGST/SGST credit", () => {
    const r = setOff(heads(100, 100, 0), heads(100, 100, 100));
    expect(r.creditLeft.igst).toBe(0);
    expect(r.creditLeft.cgst + r.creditLeft.sgst).toBe(100);
  });

  test("negative return adjustments are not transferred", () => {
    const r = setOff(heads(100, 100, 0), heads(-50, 0, 0));
    expect(r.payable).toEqual(heads(100, 100, 0));
  });
});

const line = (taxable: number): InvoiceLine => ({
  itemId: "item",
  qty: 1,
  rate: taxable,
  gstRate: 18,
  exactMath: true,
});
const bill = (
  id: string,
  type: "sale" | "purchase",
  date: string,
  taxable: number,
): Voucher => ({
  id,
  type,
  number: id,
  date,
  status: "posted",
  taxMode: "regular",
  lines: [line(taxable)],
  interState: false,
  amount: 0,
  createdAt: `${date}T10:00:00.000Z`,
});

describe("input credit carry-forward", () => {
  // Sep: purchase tax 180, no sales → 180 credit carried.
  // Oct: sale tax 90 is fully covered by the carried credit.
  const vouchers = [
    bill("p1", "purchase", "2026-09-05", 1000),
    bill("s1", "sale", "2026-10-05", 500),
  ];

  test("unused credit reduces the next month's payable", () => {
    const sep = gstMonth(vouchers, "2026-09");
    expect(sep.payable.total).toBe(0);
    expect(sep.creditLeft.total).toBe(180);
    const oct = gstMonth(vouchers, "2026-10");
    expect(oct.broughtForward.total).toBe(180);
    expect(oct.payable.total).toBe(0);
    expect(oct.creditLeft.total).toBe(90);
  });

  test("credit keeps carrying through empty months", () => {
    expect(gstMonth(vouchers, "2026-12").broughtForward.total).toBe(90);
  });

  test("GSTR-3B shows the brought-forward credit", () => {
    const r = gstr3b(vouchers, "2026-10");
    expect(r.broughtForward.total).toBe(180);
    expect(r.payable.total).toBe(0);
  });

  test("composition and cancelled bills never carry credit", () => {
    const other = [
      {
        ...bill("p2", "purchase", "2026-09-05", 1000),
        taxMode: "composition" as const,
      },
      {
        ...bill("p3", "purchase", "2026-09-06", 1000),
        status: "cancelled" as const,
      },
      bill("s2", "sale", "2026-10-05", 500),
    ];
    expect(gstMonth(other, "2026-10").payable.total).toBe(90);
  });
});

describe("exact line maths", () => {
  test("mulDivRound rounds half away from zero with whole numbers", () => {
    expect(mulDivRound(145, 100, 1000)).toBe(15);
    expect(mulDivRound(-145, 100, 1000)).toBe(-15);
    expect(mulDivRound(144, 100, 1000)).toBe(14);
    expect(mulDivRound(9_000_000_000, 9_000_000_000, 1000)).toBe(
      81_000_000_000_000_000,
    );
  });

  test.each([
    // qty, rate (paise), exact gross; the old float maths got these 1 paise low
    [0.145, 100, 15],
    [0.086, 1250, 108],
    [0.102, 1250, 128],
    [0.105, 100, 11],
  ])("%p × %p paise = %p paise", (qty, rate, gross) => {
    const exact = calcLine(
      { itemId: "i", qty, rate, gstRate: 0, exactMath: true },
      false,
    );
    expect(exact.gross).toBe(gross);
  });

  test("older lines keep the totals they were issued with", () => {
    const legacy = calcLine(
      { itemId: "i", qty: 0.145, rate: 100, gstRate: 0 },
      false,
    );
    expect(legacy.gross).toBe(14);
  });

  test("percentage discounts use exact thousandths", () => {
    // 201 × 2.5% = 5.025 → 5; 1050 × 12.5% = 131.25 → 131; 2 × 25% = 0.5 → 1
    const disc = (rate: number, discountPercent: number) =>
      calcLine(
        {
          itemId: "i",
          qty: 1,
          rate,
          gstRate: 0,
          discountPercent,
          exactMath: true,
        },
        false,
      ).discount;
    expect(disc(201, 2.5)).toBe(5);
    expect(disc(1050, 12.5)).toBe(131);
    expect(disc(2, 25)).toBe(1);
  });
});

describe("TDS base", () => {
  const bill = { amount: 11800, taxable: 10000 };
  test("GST on the settled bill is left out", () => {
    expect(tdsBase(11800, [{ amount: 11800, bill }])).toBe(10000);
    expect(calcTds(tdsBase(11800, [{ amount: 11800, bill }]), 1)).toBe(100);
  });
  test("a part payment uses the bill's taxable share", () => {
    expect(tdsBase(5900, [{ amount: 5900, bill }])).toBe(5000);
  });
  test("unallocated money and opening balances count in full", () => {
    expect(tdsBase(20000, [{ amount: 11800, bill }])).toBe(18200);
    expect(tdsBase(5000, [{ amount: 5000, bill: { amount: 5000 } }])).toBe(
      5000,
    );
  });
});

describe("report presentation", () => {
  test("second-unit text has no floating-point leftovers", () => {
    const item = {
      unit: "Nos",
      altUnit: { name: "Box", factor: 12 },
    } as Parameters<typeof altQtyText>[0];
    expect(altQtyText(item, 30.1)).toBe("2 Box 6.1 Nos");
    expect(altQtyText(item, 24)).toBe("2 Box");
    expect(altQtyText(item, -30.1)).toBe("-2 Box -6.1 Nos");
  });
});

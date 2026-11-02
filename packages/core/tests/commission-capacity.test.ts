import { expect, test } from "bun:test";
import { commissionPayoutCapacity } from "../src/accounting/commissionCapacity";

test("an earlier payout cannot reuse commission restored by a later reversal", () => {
  const entries = [
    { date: "2026-10-01", amount: 1800 },
    { date: "2026-10-05", amount: -1800 },
    { date: "2026-10-10", amount: 1800 },
  ];
  expect(commissionPayoutCapacity(entries, "2026-10-03")).toBe(0);
  expect(commissionPayoutCapacity(entries, "2026-10-10")).toBe(1800);
});

test("capacity uses the smallest daily balance and groups same-day reversals", () => {
  const entries = [
    { date: "2026-10-10", amount: 20 },
    { date: "2026-10-05", amount: -80 },
    { date: "2026-10-01", amount: 100 },
    { date: "2026-10-05", amount: 30 },
  ];
  expect(commissionPayoutCapacity(entries, "2026-10-03")).toBe(50);
  expect(commissionPayoutCapacity(entries, "2026-10-12")).toBe(70);
  expect(commissionPayoutCapacity(entries, "2026-09-30")).toBe(0);
});

test("empty, negative and out-of-range balances cannot fund payouts", () => {
  expect(commissionPayoutCapacity([], "2026-10-01")).toBe(0);
  expect(
    commissionPayoutCapacity(
      [{ date: "2026-10-01", amount: -1 }],
      "2026-10-01",
    ),
  ).toBe(0);
  expect(() =>
    commissionPayoutCapacity(
      [
        { date: "2026-10-01", amount: Number.MAX_SAFE_INTEGER },
        { date: "2026-10-01", amount: 1 },
      ],
      "2026-10-01",
    ),
  ).toThrow();
});

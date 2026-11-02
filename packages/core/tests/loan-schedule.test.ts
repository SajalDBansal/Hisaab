import { describe, expect, test } from "bun:test";
import {
  loanSchedule,
  type LoanScheduleTerms,
} from "../src/accounting/loanSchedule";

const terms = (over: Partial<LoanScheduleTerms> = {}): LoanScheduleTerms => ({
  principal: 12_000_000, // Rs 1,20,000
  annualRateBps: 1200,
  installments: 12,
  startDate: "2026-04-01",
  firstDueDate: "2026-05-01",
  scheduleModel: "fixed-principal-v2",
  interestBasis: "monthly",
  ...over,
});

describe("loan schedules", () => {
  test.each([
    "fixed-principal-monthly-v1",
    "fixed-principal-v2",
    "emi-v1",
  ] as const)(
    "%s repays exactly the principal and closes at zero",
    (scheduleModel) => {
      const s = loanSchedule(
        terms({ scheduleModel, principal: 10_000_001, installments: 7 }),
      );
      expect(s.installments.reduce((n, r) => n + r.principal, 0)).toBe(
        10_000_001,
      );
      expect(s.installments.at(-1)!.closingPrincipal).toBe(0);
      for (const r of s.installments) {
        expect(r.total).toBe(r.principal + r.interest);
        expect(r.closingPrincipal).toBe(r.openingPrincipal - r.principal);
      }
      expect(s.totalRepayment).toBe(s.totalPrincipal + s.totalInterest);
    },
  );

  test("fixed principal at 12% charges 1% a month on what is still owed", () => {
    const rows = loanSchedule(terms()).installments;
    expect(rows.map((r) => r.principal)).toEqual(Array(12).fill(1_000_000));
    expect(rows[0].interest).toBe(120_000);
    expect(rows[11].interest).toBe(10_000);
  });

  test("EMI matches the standard formula to the paisa", () => {
    const rows = loanSchedule(
      terms({ scheduleModel: "emi-v1", principal: 10_000_000 }),
    ).installments;
    const r = 0.01;
    const emi = (10_000_000 * r) / (1 - (1 + r) ** -12); // 888,487.9 paise
    for (const row of rows.slice(0, -1))
      expect(Math.abs(row.total - emi)).toBeLessThanOrEqual(1);
    expect(Math.abs(rows.at(-1)!.total - emi)).toBeLessThanOrEqual(12);
  });

  test("a zero-rate loan has no interest", () => {
    expect(loanSchedule(terms({ annualRateBps: 0 })).totalInterest).toBe(0);
  });

  test.each([
    [{ installments: 0 }, "1 to 600 installments"],
    [{ principal: 5, installments: 6 }, "1 to 600 installments"],
    [{ firstDueDate: "2026-04-01" }, "after the loan start date"],
    [{ annualRateBps: 10_001 }, "between 0 and 100 percent"],
  ] as const)("refuses %p", (over, message) => {
    expect(() => loanSchedule(terms(over))).toThrow(message);
  });
});

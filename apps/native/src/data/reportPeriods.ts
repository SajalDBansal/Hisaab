import { periodRange, type PeriodKey } from "@repo/core";

// Report screens and offline downloads must request exactly the same dated answers.
export const REPORT_PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "fy", label: "This FY" },
];

export function finalAccountsPeriod(period: PeriodKey) {
  const { from, to } = periodRange(period);
  return { from, asOf: to };
}

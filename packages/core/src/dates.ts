/**
 * Date helpers. Dates are stored as "YYYY-MM-DD" strings and shown as DD-MM-YYYY.
 * We work in whole days only, so timezones never shift a date.
 */
import type { ISODate } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function toUTC(date: ISODate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

const businessDateFormat = new Intl.DateTimeFormat("en", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Indian business date, identical on a phone and a server running in UTC. */
export function today(now = new Date()): ISODate {
  const parts = businessDateFormat.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** "2026-10-04" → "04-10-2026" */
export function formatDate(date: ISODate): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

/** "2026-10-04" → "04-10" (for compact lists) */
export function formatShortDate(date: ISODate): string {
  return formatDate(date).slice(0, 5);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-10" → "Oct" */
export function monthLabel(yearMonth: string): string {
  return MONTHS[Number(yearMonth.slice(5, 7)) - 1];
}

/** "2026-10-04" → "2026-10" */
export function yearMonth(date: ISODate): string {
  return date.slice(0, 7);
}

/** The last `count` months ending with the month of `date`, oldest first: ["2026-05", …, "2026-10"]. */
export function lastMonths(date: ISODate, count: number): string[] {
  const [y, m] = date.split("-").map(Number);
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    result.push(d.toISOString().slice(0, 7));
  }
  return result;
}

/**
 * Indian financial year label (1 April – 31 March).
 * financialYear("2026-10-04") → { start: "2026-04-01", end: "2027-03-31", label: "2026-27", short: "26-27" }
 */
export function financialYear(date: ISODate) {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    start: `${startYear}-04-01`,
    end: `${endYear}-03-31`,
    label: `${startYear}-${String(endYear).slice(2)}`,
    short: `${String(startYear).slice(2)}-${String(endYear).slice(2)}`,
  };
}

export type PeriodKey = "this-month" | "last-month" | "quarter" | "fy";

/** Date range for a report period chip. Ranges end today (or at month end for last month). */
export function periodRange(key: PeriodKey, asOf: ISODate = today()) {
  const month = yearMonth(asOf);
  if (key === "this-month")
    return { from: `${month}-01`, to: asOf, label: "This month" };
  if (key === "last-month") {
    const first = `${month}-01`;
    const lastDay = addDays(first, -1);
    return {
      from: `${yearMonth(lastDay)}-01`,
      to: lastDay,
      label: monthLabel(yearMonth(lastDay)),
    };
  }
  if (key === "quarter") {
    const start = lastMonths(asOf, 3)[0];
    return { from: `${start}-01`, to: asOf, label: "Last 3 months" };
  }
  const fy = financialYear(asOf);
  return { from: fy.start, to: asOf, label: `FY ${fy.label}` };
}

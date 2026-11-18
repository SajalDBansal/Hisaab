/**
 * Paying MSME suppliers on time (doc 37, T30). Working figures from the firm's
 * own books; nothing is posted or filed.
 *
 * MSMED Act 2006:
 * - s.15: a buyer pays a micro or small supplier by the agreed date, and the
 *   agreed period may not exceed 45 days from acceptance of the goods or
 *   services. With no agreement, payment is due by the "appointed day" (s.2(b)):
 *   15 days after acceptance.
 * - s.16: on late payment the buyer owes compound interest with monthly rests,
 *   at three times the bank rate notified by the RBI, from the day after the
 *   due date.
 * - Medium enterprises are not "suppliers" under s.2(n), so the rule covers
 *   micro and small enterprises only.
 *
 * Income Tax Act s.43B(h): an amount due to a micro or small enterprise and not
 * paid within the s.15 time limit is allowed as an expense only in the year it
 * is actually paid.
 *
 * Hisaab does not record when goods were accepted, so the bill date stands in
 * for the acceptance date.
 */
import { addDays, daysBetween } from "../dates";
import type { ISODate, MsmeType, Paise } from "../types";

/** The longest payment period the Act allows (s.15). */
export const MSME_MAX_DAYS = 45;
/** Payment period when nothing was agreed (s.2(b), the appointed day). */
export const MSME_NO_AGREEMENT_DAYS = 15;
/** Bills this close to their date are flagged as due soon. */
export const MSME_DUE_SOON_DAYS = 7;
/**
 * Default yearly rate for s.16 interest: three times an RBI bank rate of
 * 5.50%. The RBI changes the bank rate; the report takes the rate as an input.
 */
export const DEFAULT_MSME_INTEREST_RATE = 16.5;

/** Micro and small suppliers are covered by s.15-16 and s.43B(h); medium are not. */
export const msmeCovered = (type: MsmeType | undefined): boolean =>
  type === "micro" || type === "small";

/**
 * The last day to pay an MSME bill: the agreed credit period (bill date to due
 * date), capped at 45 days; 15 days when no credit period was agreed.
 */
export function msmePayBy(billDate: ISODate, dueDate?: ISODate): ISODate {
  const agreed = dueDate ? daysBetween(billDate, dueDate) : 0;
  const days =
    agreed > 0 ? Math.min(agreed, MSME_MAX_DAYS) : MSME_NO_AGREEMENT_DAYS;
  return addDays(billDate, days);
}

/** The same day `months` calendar months later, clamped to the month's end (31 Jan + 1 = 28/29 Feb). */
export function addCalendarMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * s.16 interest on `pending` paise, unpaid after `payBy`, up to `asOf`, at
 * `annualRate` percent a year, compounded with monthly rests:
 *
 *   whole months m from payBy (calendar months), then d leftover days;
 *   amount  = pending × (1 + rate/1200)^m × (1 + rate × d / 36500)
 *   interest = round(amount − pending) in paise.
 *
 * Interest is worked out on what is still unpaid today; part payments made
 * late are not traced back, so it can understate interest on bills paid in
 * parts after the due date.
 */
export function msmeInterest(
  pending: Paise,
  payBy: ISODate,
  asOf: ISODate,
  annualRate: number,
): { months: number; days: number; interest: Paise } {
  if (pending <= 0 || asOf <= payBy || annualRate <= 0)
    return { months: 0, days: 0, interest: 0 };
  let months = 0;
  while (addCalendarMonths(payBy, months + 1) <= asOf) months++;
  const days = daysBetween(addCalendarMonths(payBy, months), asOf);
  const amount =
    pending *
    Math.pow(1 + annualRate / 1200, months) *
    (1 + (annualRate * days) / 36_500);
  return { months, days, interest: Math.round(amount - pending) };
}

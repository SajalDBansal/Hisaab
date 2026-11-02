import type { Allocation, ISODate, Paise, Voucher } from "../types";
import { billAllocations, sumPaise } from "./settlements";

function settlementTimeline(bill: Voucher, vouchers: Voucher[]) {
  const byDate = new Map<ISODate, Paise>();
  for (const voucher of vouchers) {
    if (voucher.status !== "posted" || voucher.partyId !== bill.partyId)
      continue;
    // The target bill identifies the book, including receipts split across books.
    const amounts = billAllocations(voucher)
      .filter((allocation) => allocation.voucherId === bill.id)
      .map((allocation) => allocation.amount);
    if (!amounts.length) continue;
    byDate.set(
      voucher.date,
      sumPaise([byDate.get(voucher.date) ?? 0, ...amounts]),
    );
  }
  // Reports have day-level cutoffs, so same-day signed corrections move together.
  return [...byDate].sort(([a], [b]) => a.localeCompare(b));
}

function pendingAmount(bill: Voucher, settled: Paise): Paise {
  if (settled < 0 || settled > bill.amount)
    throw new Error(
      "Reconcile this bill's existing allocations before saving the return.",
    );
  return bill.amount - settled;
}

/** Allocate at the return date without rewriting issued vouchers or later settlements. */
export function returnAllocations(
  bill: Voucher,
  vouchers: Voucher[],
  date: ISODate,
  amount: Paise,
): Allocation[] {
  if (
    bill.status !== "posted" ||
    (bill.type !== "sale" && bill.type !== "purchase")
  )
    throw new Error("Pick a posted sale or purchase bill to return against.");
  if (date < bill.date)
    throw new Error("A return can't be dated before its bill.");
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(bill.amount) ||
    amount < 0 ||
    bill.amount < 0
  )
    throw new Error("Use non-negative whole paise within safe limits.");

  const timeline = settlementTimeline(bill, vouchers);
  let settled = sumPaise(
    timeline.filter(([day]) => day <= date).map(([, delta]) => delta),
  );
  const againstBill = Math.min(amount, pendingAmount(bill, settled));

  for (const [day, delta] of timeline) {
    if (day <= date) continue;
    settled = sumPaise([settled, delta]);
    const pending = pendingAmount(bill, settled);
    // A later release must not strand return credit outside a newly reopened bill.
    if (againstBill > pending || Math.min(amount, pending) > againstBill)
      throw new Error(
        `This return conflicts with settlements dated ${day}. Reconcile those entries first.`,
      );
  }
  return againstBill > 0 ? [{ voucherId: bill.id, amount: againstBill }] : [];
}

import type { ISODate, Party, Voucher } from "../types";
import { partyEffect } from "./bills";
import { sumPaise } from "./settlements";

/** Include allocation-only journals as well as money movements when checking available funds. */
export function partySettlementDates(
  party: Party,
  vouchers: Voucher[],
  date: ISODate,
  through: ISODate,
): ISODate[] {
  const dates = new Set([date, through, party.openingDate]);
  for (const voucher of vouchers) {
    if (
      voucher.status === "posted" &&
      (voucher.partyId === party.id || partyEffect(voucher, party.id) !== 0)
    )
      dates.add(voucher.date);
  }
  return [...dates].filter((day) => day >= date && day <= through).sort();
}

/** Refund only credit that remains available on every later date in the selected book. */
export function partyRefundCapacity(
  party: Party,
  vouchers: Voucher[],
  date: ISODate,
  through: ISODate,
): number {
  if (date > through) return 0;
  const changes = new Map<ISODate, number>([[date, 0]]);
  const add = (day: ISODate, amount: number) => {
    if (day <= through)
      changes.set(day, sumPaise([changes.get(day) ?? 0, amount]));
  };
  add(party.openingDate, party.openingBalance);
  for (const voucher of vouchers) {
    if (voucher.status !== "posted") continue;
    const amount = partyEffect(voucher, party.id);
    if (amount) add(voucher.date, amount);
  }
  const direction = party.type === "customer" ? -1 : 1;
  let balance = 0;
  let capacity = Number.MAX_SAFE_INTEGER;
  // Same-day entries share the report's date cutoff; reversals are ordinary signed movements.
  for (const [day, amount] of [...changes].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    balance = sumPaise([balance, amount]);
    if (day >= date) capacity = Math.min(capacity, direction * balance);
  }
  return Math.max(0, capacity);
}

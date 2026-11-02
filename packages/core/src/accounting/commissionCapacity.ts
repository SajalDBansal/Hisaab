import { sumPaise } from "./settlements";

/** Pay only commission that remains available at every later recorded date. */
export function commissionPayoutCapacity(
  entries: ReadonlyArray<{ date: string; amount: number }>,
  date: string,
): number {
  const changes = new Map<string, number>([[date, 0]]);
  for (const entry of entries)
    changes.set(
      entry.date,
      sumPaise([changes.get(entry.date) ?? 0, entry.amount]),
    );
  let balance = 0;
  let capacity = Number.MAX_SAFE_INTEGER;
  // Group the day's entries so the check agrees with dated statements and reversals.
  for (const [day, amount] of [...changes].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    balance = sumPaise([balance, amount]);
    if (day >= date) capacity = Math.min(capacity, balance);
  }
  return Math.max(0, capacity);
}

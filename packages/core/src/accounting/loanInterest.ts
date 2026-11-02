import { sumPaise } from "./settlements";

interface InterestEntry {
  id: string;
  firmId: string;
  loanId: string | null;
  installmentNumber: number | null;
  kind: string;
  sourceEntryId: string | null;
  date: string;
  amount: number;
}

function samePeriod(a: InterestEntry, b: InterestEntry) {
  return (
    a.firmId === b.firmId &&
    a.loanId === b.loanId &&
    a.installmentNumber === b.installmentNumber
  );
}

export function loanInterestReversalDate(
  entries: InterestEntry[],
  entry: InterestEntry,
): string | undefined {
  return entries.find(
    (e) =>
      samePeriod(e, entry) &&
      e.kind === "reversal" &&
      e.sourceEntryId === entry.id,
  )?.date;
}

export function loanInterestPaymentCapacity(
  entries: InterestEntry[],
  accrual: InterestEntry,
  date: string,
): number {
  const reversedOn = loanInterestReversalDate(entries, accrual);
  if (date < accrual.date || (reversedOn && reversedOn <= date)) return 0;
  const payments = entries
    .filter(
      (e) =>
        samePeriod(e, accrual) &&
        e.kind === "loan-interest-payment" &&
        e.sourceEntryId === accrual.id,
    )
    .map((e) => ({
      date: e.date,
      amount: e.amount,
      reversedOn: loanInterestReversalDate(entries, e),
    }));
  const dates = new Set([
    date,
    ...(reversedOn ? [reversedOn] : []),
    ...payments.flatMap((p) => [
      p.date,
      ...(p.reversedOn ? [p.reversedOn] : []),
    ]),
  ]);
  let capacity = accrual.amount;
  // A backdated payment must leave every later recorded balance nonnegative.
  for (const cutoff of dates) {
    if (cutoff < date) continue;
    const accrued = reversedOn && reversedOn <= cutoff ? 0 : accrual.amount;
    const paid = sumPaise(
      payments
        .filter(
          (p) => p.date <= cutoff && (!p.reversedOn || p.reversedOn > cutoff),
        )
        .map((p) => p.amount),
    );
    capacity = Math.min(capacity, sumPaise([accrued, -paid]));
  }
  return Math.max(0, capacity);
}

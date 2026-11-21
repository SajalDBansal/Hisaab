import type { Firm, ISODate, Party, Voucher } from "../types";
import { partyBills, partyEffect, type Bill } from "./bills";
import { scopeBooks } from "./bookScope";
import type { Books } from "./generalLedger";
import { settlementUnallocatedAdjustment, sumPaise } from "./settlements";

type AllocationBooks = Books & { firm?: Firm };

export interface PaymentAllocationChange {
  voucher: Voucher;
  before: number;
  allocated: number;
}

function allocatedAmount(voucher: Voucher): number {
  return sumPaise((voucher.allocations ?? []).map((a) => a.amount));
}

function remainingAmount(voucher: Voucher): number {
  return sumPaise([
    voucher.amount,
    voucher.tds?.amount ?? 0,
    -allocatedAmount(voucher),
  ]);
}

function availableFunds(
  party: Party,
  vouchers: Voucher[],
  bills: Bill[],
  date: ISODate,
): number {
  const visible = vouchers.filter(
    (v) => v.status === "posted" && v.date <= date,
  );
  const type = party.type === "customer" ? "receipt" : "payment";
  const ordinary = sumPaise(
    visible
      .filter((v) => v.partyId === party.id && v.type === type)
      .map((v) => Math.max(0, remainingAmount(v))),
  );
  const unallocated = sumPaise([
    ordinary,
    settlementUnallocatedAdjustment(party.id, visible),
  ]);
  const direction = party.type === "customer" ? 1 : -1;
  const effects = visible.flatMap((v) =>
    v.type === "journal"
      ? (v.journalLines ?? [])
          .filter((line) => line.account === `party:${party.id}`)
          .flatMap((line) => [line.debit, -line.credit])
      : [partyEffect(v, party.id)],
  );
  const funding = sumPaise([
    ...bills.map((b) => b.pending),
    -direction * (party.openingDate <= date ? party.openingBalance : 0),
    ...effects.map((amount) => -direction * amount),
  ]);
  return Math.max(0, Math.min(unallocated, funding));
}

function allocationDates(books: AllocationBooks, party: Party, asOf: ISODate) {
  return [
    ...new Set([
      asOf,
      party.openingDate,
      ...(party.openingBills ?? []).map((b) => b.openingDate),
      ...books.vouchers.filter((v) => v.status === "posted").map((v) => v.date),
    ]),
  ].sort();
}

function allocationCapacity(
  books: AllocationBooks,
  party: Party,
  source: Voucher,
  billId: string,
  dates: ISODate[],
): number {
  let available = Math.max(0, remainingAmount(source));
  // Saved links take effect once both source and bill exist, including before asOf.
  for (const date of dates) {
    if (date < source.date) continue;
    const bills = partyBills(party, books.vouchers, date);
    const bill = bills.find((b) => b.id === billId);
    if (!bill) continue;
    available = Math.min(
      available,
      bill.pending,
      availableFunds(party, books.vouchers, bills, date),
    );
    if (available <= 0) break;
  }
  return available;
}

/** Append funded bill links; callers own edit timestamps, audit and persistence. */
export function allocateAvailablePayments(
  books: AllocationBooks,
  party: Party,
  asOf: ISODate,
): { allocated: number; changes: PaymentAllocationChange[] } {
  const type = party.type === "customer" ? "receipt" : "payment";
  // Stage every link so a whole-paise validation failure cannot leave partial changes.
  const working = { ...books, vouchers: books.vouchers.map((v) => ({ ...v })) };
  const sources = working.vouchers
    .filter(
      (v) =>
        v.partyId === party.id &&
        v.type === type &&
        v.status === "posted" &&
        !v.settlementLocked &&
        !v.settlementKind &&
        v.date <= asOf,
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.number.localeCompare(b.number) ||
        a.id.localeCompare(b.id),
    );
  const dates = allocationDates(working, party, asOf);
  const wholeBills = new Map(
    partyBills(party, working.vouchers, asOf).map((b) => [b.id, b.amount]),
  );
  const changes: PaymentAllocationChange[] = [];
  for (const source of sources) {
    const before = allocatedAmount(source);
    for (const scope of ["gst", "nongst"] as const) {
      let scoped = scopeBooks(working, scope);
      const scopedParty = scoped.parties.find((p) => p.id === party.id);
      if (!scopedParty) throw new Error("Party not found.");
      const scopedSource = scoped.vouchers.find((v) => v.id === source.id);
      if (!scopedSource || remainingAmount(scopedSource) <= 0) continue;
      for (const bill of partyBills(scopedParty, scoped.vouchers, asOf)) {
        if (bill.pending <= 0) continue;
        // Split openings use cumulative rounding; keep their existing book shares intact.
        if (bill.amount !== wholeBills.get(bill.id)) continue;
        const amount = allocationCapacity(
          scoped,
          scopedParty,
          source,
          bill.id,
          dates,
        );
        if (amount <= 0) continue;
        source.allocations = [
          ...(source.allocations ?? []),
          { voucherId: bill.id, amount },
        ];
        scoped = scopeBooks(working, scope);
      }
    }
    const allocated = sumPaise([allocatedAmount(source), -before]);
    if (allocated > 0) changes.push({ voucher: source, before, allocated });
  }
  const allocated = sumPaise(changes.map((change) => change.allocated));
  for (const change of changes) {
    const original = books.vouchers.find((v) => v.id === change.voucher.id)!;
    original.allocations = change.voucher.allocations;
    change.voucher = original;
  }
  return { allocated, changes };
}

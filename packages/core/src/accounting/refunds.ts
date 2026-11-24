/**
 * Refunds and unused credit (doc 37, T05).
 *
 * A refund is a payment to a customer (their advance or unused credit-note
 * credit paid back: Customer Dr / Cash-Bank Cr) or a receipt from a supplier
 * (our advance or debit-note credit paid back: Cash-Bank Dr / Supplier Cr).
 * It settles no bills, has no TDS and is limited to the credit the party has
 * in that book on its date and every later date. Settlement refunds posted by
 * an accountant (customer-refund / supplier-refund) count the same way.
 *
 * Unused credit from credit notes (customers) and debit notes (suppliers) is
 * applied to later bills by the same "allocate" action as on-account money.
 */
import type { ISODate, Paise, Party, Voucher } from "../types";
import { isPosted, partyBalance, partyBills } from "./bills";
import type { BookScope } from "../types";
import { scopeBooks } from "./bookScope";
import type { Books } from "./generalLedger";
import { partyRefundCapacity } from "./refundCapacity";
import { sumPaise } from "./settlements";

/** The money voucher type that pays a party back. */
export const refundType = (party: Pick<Party, "type">) =>
  party.type === "customer" ? ("payment" as const) : ("receipt" as const);

/** The return voucher type whose leftover is credit for this party. */
export const noteType = (party: Pick<Party, "type">) =>
  party.type === "customer"
    ? ("credit-note" as const)
    : ("debit-note" as const);

/** Refunds of a party's money: opposite-way payments/receipts, never settlement entries. */
export function isMoneyRefund(v: Voucher, party: Pick<Party, "id" | "type">) {
  return (
    v.partyId === party.id && v.type === refundType(party) && !v.settlementKind
  );
}

/** Posted money refunds of this party, in paise. */
export function moneyRefunds(
  party: Pick<Party, "id" | "type">,
  vouchers: Voucher[],
): Paise {
  return sumPaise(
    vouchers
      .filter((v) => isPosted(v) && isMoneyRefund(v, party))
      .map((v) => v.amount),
  );
}

const allocated = (v: Voucher) =>
  sumPaise((v.allocations ?? []).map((a) => a.amount));

/** What is left of a return after the bills it was applied to. */
export const noteLeftover = (v: Voucher) =>
  Math.max(0, sumPaise([v.amount, -allocated(v)]));

/**
 * Unused credit from returns (credit notes for customers, debit notes for
 * suppliers), never more than the party's whole unused credit.
 */
export function unappliedNoteCredit(
  party: Party,
  vouchers: Voucher[],
  asOf: ISODate,
): Paise {
  const left = sumPaise(
    vouchers
      .filter(
        (v) =>
          isPosted(v) &&
          v.partyId === party.id &&
          v.type === noteType(party) &&
          v.date <= asOf,
      )
      .map(noteLeftover),
  );
  if (!left) return 0;
  const direction = party.type === "customer" ? 1 : -1;
  const funding = sumPaise([
    ...partyBills(party, vouchers, asOf).map((b) => b.pending),
    -direction * partyBalance(party, vouchers, asOf),
  ]);
  return Math.max(0, Math.min(left, funding));
}

/** How much can be refunded to (or by) the party in each book on this date. */
export function refundableByBook(
  party: Party,
  books: Books,
  date: ISODate,
  through: ISODate,
): Record<BookScope, Paise> {
  const one = (scope: BookScope) => {
    const scoped = scopeBooks(books, scope);
    const p = scoped.parties.find((row) => row.id === party.id);
    return p ? partyRefundCapacity(p, scoped.vouchers, date, through) : 0;
  };
  return { gst: one("gst"), nongst: one("nongst") };
}

/** Refuse a refund that settles bills, keeps TDS or exceeds the party's credit. */
export function checkRefund(
  books: Books,
  party: Party,
  input: {
    date: ISODate;
    amount: Paise;
    bookScope: BookScope;
    allocations: { amount: Paise }[];
    tds?: { amount: Paise };
  },
  through: ISODate,
) {
  if (input.allocations.some((a) => a.amount > 0))
    throw new Error("A refund doesn't settle bills.");
  if (input.tds?.amount) throw new Error("A refund has no TDS.");
  const capacity = refundableByBook(party, books, input.date, through)[
    input.bookScope
  ];
  if (input.amount > capacity)
    throw new Error(
      `The refund is more than the ${party.type === "customer" ? "customer's" : "supplier's"} unused credit in this book (${(capacity / 100).toFixed(2)}).`,
    );
}

import type { BookScope, Firm, Party, TaxScope, Voucher } from "../types";
import type { Books } from "./generalLedger";
import { isOpeningBillId } from "./openingImport";
import {
  openingGst,
  openingSettlementShares,
  proportionalPaise,
} from "./openingAllocation";

/** Category is saved on new entries; legacy bills retain their original tax treatment. */
export function bookScopeOf(v: Voucher): BookScope {
  if (v.bookScope) return v.bookScope;
  if (v.taxMode === "off") return "nongst";
  if (v.lines?.length)
    return v.lines.some(
      (l) =>
        l.bookScope === "gst" ||
        (!l.bookScope && (l.taxType === "taxable" || l.gstRate > 0)),
    )
      ? "gst"
      : "nongst";
  return "gst";
}

/** Split settlements by their bills; unallocated money stays in its selected category. */
function scopedMoney(
  v: Voucher,
  vouchers: Voucher[],
  scope: BookScope,
  openingScope: BookScope,
  openingShares: Map<string, number[]>,
): Voucher | undefined {
  const total = v.amount + (v.tds?.amount ?? 0);
  const allocations = v.allocations ?? [];
  const belongs = (id: string) =>
    isOpeningBillId(id)
      ? openingScope
      : bookScopeOf(vouchers.find((b) => b.id === id) ?? v);
  const gstAllocations = allocations.map((a, index) =>
    isOpeningBillId(a.voucherId)
      ? (openingShares.get(v.id)?.[index] ??
        (openingScope === "gst" ? a.amount : 0))
      : belongs(a.voucherId) === "gst"
        ? a.amount
        : 0,
  );
  const gstSettled = gstAllocations.reduce((n, amount) => n + amount, 0);
  const unallocated = Math.max(
    0,
    total - allocations.reduce((n, a) => n + a.amount, 0),
  );
  const gstTotal = gstSettled + (bookScopeOf(v) === "gst" ? unallocated : 0);
  const gstCash = proportionalPaise(v.amount, gstTotal, total);
  const amount = scope === "gst" ? gstCash : v.amount - gstCash;
  const settlement = scope === "gst" ? gstTotal : total - gstTotal;
  if (!settlement) return undefined;
  return {
    ...v,
    bookScope: scope,
    amount,
    tds: v.tds ? { ...v.tds, amount: settlement - amount } : undefined,
    allocations: allocations
      .map((a, index) => ({
        ...a,
        amount:
          scope === "gst"
            ? gstAllocations[index]
            : a.amount - gstAllocations[index],
      }))
      .filter((a) => a.amount > 0),
  };
}

/** One partition feeds all reports; shared legacy openings belong to the firm's default book. */
export function scopeBooks<T extends Books & { firm?: Firm }>(
  books: T,
  scope: TaxScope = "all",
): T {
  if (scope === "all") return books;
  const openingScope: BookScope =
    books.firm?.gstRegistration === "unregistered" ? "nongst" : "gst";
  const part = (total: number, gst?: number) =>
    scope === "gst"
      ? openingGst(total, gst, openingScope)
      : total - openingGst(total, gst, openingScope);
  const vouchers = scopeVouchers(
    books.vouchers,
    scope,
    openingScope,
    books.parties,
  );
  return {
    ...books,
    vouchers,
    parties: books.parties.map((p) => ({
      ...p,
      openingBalance: part(p.openingBalance, p.openingGstBalance),
      openingBills: p.openingBills
        ?.map((bill) => ({
          ...bill,
          amount: part(bill.amount, bill.gstAmount),
          gstAmount: scope === "gst" ? bill.gstAmount : 0,
        }))
        .filter((bill) => bill.amount > 0),
    })),
    ledgers: books.ledgers.map((l) => ({
      ...l,
      openingBalance: part(l.openingBalance, l.openingGstBalance),
    })),
    accounts: books.accounts?.map((a) => ({
      ...a,
      openingBalance: part(a.openingBalance, a.openingGstBalance),
    })),
    openingAccounts: books.openingAccounts.map((a) => ({
      ...a,
      amount: part(a.amount, a.openingGstAmount),
    })),
    items: books.items.map((i) => ({
      ...i,
      openingLots: i.openingLots?.filter((lot) => lot.bookScope === scope),
      openingStock: i.openingLots
        ? i.openingLots
            .filter((lot) => lot.bookScope === scope)
            .reduce((sum, lot) => sum + lot.qty, 0)
        : (i.openingBookScope ??
              (i.taxType === "nongst" ? "nongst" : openingScope)) === scope
          ? i.openingStock
          : 0,
    })),
  };
}

/** Daybook uses the same settlement partition as the financial statements. */
export function scopeVouchers(
  vouchers: Voucher[],
  scope: TaxScope,
  defaultScope: BookScope = "gst",
  parties: Party[] = [],
): Voucher[] {
  if (scope === "all") return vouchers;
  const openingShares = openingSettlementShares(
    vouchers,
    parties,
    defaultScope,
  );
  return vouchers.flatMap((original) => {
    const v =
      !original.bookScope && !original.lines?.length
        ? { ...original, bookScope: defaultScope }
        : original;
    if (v.type === "receipt" || v.type === "payment") {
      const part = scopedMoney(v, vouchers, scope, defaultScope, openingShares);
      return part ? [part] : [];
    }
    return bookScopeOf(v) === scope ? [v] : [];
  });
}

import type { BookScope, Party, Voucher } from "../types";
import { isPosted } from "./bills";
import { importedOpeningShares } from "./openingImport";

/** A missing allocation preserves the original firm's default book. */
export function openingGst(
  total: number,
  gst: number | undefined,
  scope: BookScope,
) {
  return gst ?? (scope === "gst" ? total : 0);
}

/** Integer arithmetic avoids losing a paise when multiplying large balances. */
export function proportionalPaise(amount: number, part: number, total: number) {
  if (!total) return 0;
  return Number(
    (BigInt(amount) * BigInt(part) * 2n + BigInt(total)) / (BigInt(total) * 2n),
  );
}

/** Cumulative rounding makes every installment add back to the exact opening split. */
export function openingSettlementShares(
  vouchers: Voucher[],
  parties: Party[],
  scope: BookScope,
) {
  const openings = new Map(
    parties.map((p) => [
      `opening:${p.id}`,
      {
        total: Math.abs(p.openingBalance),
        gst: Math.abs(openingGst(p.openingBalance, p.openingGstBalance, scope)),
      },
    ]),
  );
  for (const party of parties)
    for (const [id, share] of importedOpeningShares(party.openingBills ?? []))
      openings.set(id, share);
  const consumed = new Map<string, number>();
  const shares = new Map<string, number[]>();
  const ordered = [...vouchers].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id),
  );
  for (const v of ordered) {
    if (!isPosted(v)) continue;
    if (v.type !== "receipt" && v.type !== "payment") {
      // Signed corrections/writeoffs consume their journal's explicit book.
      // Start a new rounding interval on the remaining opening after each delta.
      for (const allocation of v.settlementAllocations ?? []) {
        const opening = openings.get(allocation.voucherId);
        if (!opening) continue;
        const previous = consumed.get(allocation.voucherId) ?? 0;
        openings.set(allocation.voucherId, {
          total: opening.total - previous - allocation.amount,
          gst:
            opening.gst -
            proportionalPaise(previous, opening.gst, opening.total) -
            ((v.bookScope ?? scope) === "gst" ? allocation.amount : 0),
        });
        consumed.set(allocation.voucherId, 0);
      }
      continue;
    }
    shares.set(
      v.id,
      (v.allocations ?? []).map((allocation) => {
        const opening = openings.get(allocation.voucherId);
        if (!opening) return scope === "gst" ? allocation.amount : 0;
        const previous = consumed.get(allocation.voucherId) ?? 0;
        const next = previous + allocation.amount;
        consumed.set(allocation.voucherId, next);
        return (
          proportionalPaise(next, opening.gst, opening.total) -
          proportionalPaise(previous, opening.gst, opening.total)
        );
      }),
    );
  }
  return shares;
}

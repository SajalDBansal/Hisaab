import type { ReturnAmounts, Voucher } from "../types";
import { isStoredQuantity } from "../precision";
import { bookScopeOf } from "./bookScope";
import { calcInvoice } from "./invoice";

export interface ReturnAmountBasis {
  qty: number;
  returnedQty: number;
  original: ReturnAmounts;
  returned: ReturnAmounts;
}

const components = [
  "taxable",
  "discount",
  "cgst",
  "sgst",
  "igst",
  "roundOff",
] as const;
const emptyAmounts = (): ReturnAmounts => ({
  taxable: 0,
  discount: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  roundOff: 0,
});

const credit = (amounts: ReturnAmounts) =>
  amounts.taxable +
  amounts.cgst +
  amounts.sgst +
  amounts.igst +
  amounts.roundOff;

// Integer products avoid losing paise when quantities or amounts are large.
function portion(amount: number, part: number, total: number): number {
  if (!total) return 0;
  const divisor = BigInt(total);
  const sign = amount < 0 ? -1 : 1;
  const half = (divisor - (sign < 0 ? 1n : 0n)) / 2n;
  return (
    sign * Number((BigInt(Math.abs(amount)) * BigInt(part) + half) / divisor)
  );
}

function voucherAmounts(voucher: Voucher): ReturnAmounts[] {
  const totals = calcInvoice({
    lines: voucher.lines ?? [],
    charges: voucher.charges,
    interState: !!voucher.interState,
  });
  let value = 0;
  return totals.lines.map((line, index) => {
    const saved = voucher.lines?.[index]?.returnAmounts;
    if (saved) return { ...saved };
    const before = value;
    value += line.total;
    // Goods receive only their share of bill rounding; charges and their GST stay on the bill.
    const roundOff = voucher.amount - totals.totalBeforeRound;
    return {
      taxable: line.taxable,
      discount: line.discount,
      cgst: line.cgst,
      sgst: line.sgst,
      igst: line.igst,
      roundOff:
        portion(roundOff, value, totals.totalBeforeRound) -
        portion(roundOff, before, totals.totalBeforeRound),
    };
  });
}

/** Existing issued returns stay fixed, including later-dated returns and legacy rounding. */
export function returnAmountBasis(
  bill: Voucher,
  vouchers: Voucher[],
): ReturnAmountBasis[] {
  const original = voucherAmounts(bill);
  const rows = (bill.lines ?? []).map((line, index) => ({
    qty: line.qty,
    returnedQty: 0,
    original: original[index],
    returned: emptyAmounts(),
  }));
  const type = bill.type === "sale" ? "credit-note" : "debit-note";
  for (const note of vouchers) {
    if (
      note.status !== "posted" ||
      note.againstId !== bill.id ||
      note.type !== type ||
      note.partyId !== bill.partyId ||
      bookScopeOf(note) !== bookScopeOf(bill)
    )
      continue;
    const amounts = voucherAmounts(note);
    (note.lines ?? []).forEach((line, index) => {
      const row =
        line.sourceLine === undefined ? undefined : rows[line.sourceLine];
      if (!row)
        throw new Error(
          "An existing return has no matching bill line; review it before returning more goods.",
        );
      row.returnedQty =
        (Math.round(row.returnedQty * 1000) + Math.round(line.qty * 1000)) /
        1000;
      for (const key of components) row.returned[key] += amounts[index][key];
    });
  }
  return rows;
}

/** Allocate original components cumulatively, with the final return taking the actual residual. */
export function returnAmounts(
  basis: ReturnAmountBasis,
  qty: number,
): ReturnAmounts {
  const total = Math.round(basis.qty * 1000);
  const used = Math.round(basis.returnedQty * 1000);
  const take = Math.round(qty * 1000);
  if (!isStoredQuantity(qty) || take <= 0 || used + take > total)
    throw new Error(
      "Pick a positive return quantity within the remaining bill quantity.",
    );
  const result = emptyAmounts();
  for (const key of components) {
    if (key === "roundOff") continue;
    const original = basis.original[key];
    const returned = basis.returned[key];
    if (returned > original)
      throw new Error(
        "Earlier returns exceed an original bill component; review those notes before returning more goods.",
      );
    const target = portion(original, used + take, total);
    // Cancellation can leave a rounded paise already credited; do not credit it twice.
    result[key] = Math.max(target, returned) - returned;
  }
  const originalCredit = credit(basis.original);
  const returnedCredit = credit(basis.returned);
  if (returnedCredit > originalCredit)
    throw new Error(
      "Earlier returns exceed the remaining credit; review those notes before returning more goods.",
    );
  const targetCredit = portion(originalCredit, used + take, total);
  // Round-off absorbs component paise so even tiny returns never exceed the original credit.
  result.roundOff =
    Math.max(targetCredit, returnedCredit) - returnedCredit - credit(result);
  return result;
}

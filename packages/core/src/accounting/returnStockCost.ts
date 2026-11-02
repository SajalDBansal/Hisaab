import type { Voucher } from "../types";
import { isStoredQuantity } from "../precision";
import { bookScopeOf } from "./bookScope";
import { sumPaise } from "./settlements";

/** Keep issued return costs fixed and give the final return the actual remaining cost. */
export function returnStockCost(
  bill: Voucher,
  vouchers: Voucher[],
  sourceLine: number,
  qty: number,
): number | undefined {
  const source = bill.lines?.[sourceLine];
  // Legacy sales without a saved cost retain their existing stock replay behavior.
  if (source?.stockCost === undefined) return undefined;
  const returns = vouchers
    .filter(
      (note) =>
        note.status === "posted" &&
        note.type === "credit-note" &&
        note.againstId === bill.id &&
        note.partyId === bill.partyId &&
        bookScopeOf(note) === bookScopeOf(bill),
    )
    .flatMap((note) => note.lines ?? [])
    .filter((line) => line.sourceLine === sourceLine);
  if (
    !Number.isSafeInteger(source.stockCost) ||
    source.stockCost < 0 ||
    returns.some(
      (line) =>
        line.stockCost === undefined ||
        !Number.isSafeInteger(line.stockCost) ||
        line.stockCost < 0,
    )
  )
    throw new Error(
      "Review the bill and earlier returns' saved stock costs before returning more goods.",
    );
  const restored = sumPaise(returns.map((line) => line.stockCost!));
  if (restored > source.stockCost)
    throw new Error(
      "Earlier returns exceed the bill's original stock cost; review those notes before returning more goods.",
    );
  const total = Math.round(source.qty * 1000);
  const used = sumPaise(returns.map((line) => Math.round(line.qty * 1000)));
  const take = Math.round(qty * 1000);
  if (
    !isStoredQuantity(source.qty) ||
    !isStoredQuantity(qty) ||
    total <= 0 ||
    take <= 0 ||
    used + take > total
  )
    throw new Error(
      "Choose a return quantity within the remaining bill quantity.",
    );
  // Integer products preserve paise even when quantity times cost exceeds Number precision.
  const divisor = BigInt(total);
  const target = Number(
    (BigInt(source.stockCost) * BigInt(used + take) + divisor / 2n) / divisor,
  );
  return Math.max(target, restored) - restored;
}

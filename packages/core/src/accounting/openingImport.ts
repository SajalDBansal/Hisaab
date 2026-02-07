import { daysBetween } from "../dates";
import type { Bill } from "./bills";
import type { Party, Voucher } from "../types";
import { billAllocations } from "./settlements";

export const MAX_OPENING_IMPORT_PAISE = 1_000_000_000_000;
export type OpeningMoneyRow = {
  row: number;
  targetKind: "party" | "ledger" | "account";
  targetId: string;
  date: string;
  amount: number;
  gstAmount: number;
};
export type OpeningBillRow = {
  row: number;
  partyId: string;
  number: string;
  date: string;
  dueDate: string;
  openingDate: string;
  amount: number;
  gstAmount: number;
};
export type OpeningStockRow = {
  row: number;
  itemId: string;
  lotNumber: string;
  date: string;
  bookScope: "gst" | "nongst";
  quantity: number;
  unitCost: number;
  value: number;
};
export type OpeningBill = Omit<OpeningBillRow, "row"> & { id: string };

export const importedOpeningBillId = (id: string) => `opening-bill:${id}`;
export const isOpeningBillId = (id: string) =>
  id.startsWith("opening:") || id.startsWith("opening-bill:");

/** Reject a rounding/overflow ambiguity rather than silently changing cutover books. */
export function sumOpeningAmounts(values: number[]): number {
  const sum = values.reduce((total, value) => {
    if (!Number.isSafeInteger(value))
      throw new Error("Opening amounts must be whole safe paise.");
    return total + BigInt(value);
  }, 0n);
  if (
    sum > BigInt(Number.MAX_SAFE_INTEGER) ||
    sum < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new Error("Opening totals exceed the supported amount limit.");
  return Number(sum);
}

export function openingImportTotals(
  money: OpeningMoneyRow[],
  bills: OpeningBillRow[],
  stock: OpeningStockRow[],
) {
  return (["gst", "nongst", "all"] as const).map((scope) => {
    const share = (amount: number, gst: number) =>
      scope === "all" ? amount : scope === "gst" ? gst : amount - gst;
    const amounts = money.map((r) => share(r.amount, r.gstAmount));
    const stockValue = sumOpeningAmounts(
      stock
        .filter((r) => scope === "all" || r.bookScope === scope)
        .map((r) => r.value),
    );
    const debit = sumOpeningAmounts([
      ...amounts.filter((n) => n > 0),
      stockValue,
    ]);
    const credit = sumOpeningAmounts(
      amounts.filter((n) => n < 0).map((n) => -n),
    );
    const net = sumOpeningAmounts([debit, -credit]);
    return {
      scope,
      debit,
      credit,
      net,
      capital: -net,
      stockValue,
      billAmount: sumOpeningAmounts(
        bills.map((r) => share(r.amount, r.gstAmount)),
      ),
    };
  });
}

/** Bill rows only partition an existing opening. They never add a second opening. */
export function reconcileOpeningBills(
  parties: Pick<
    Party,
    "id" | "type" | "openingBalance" | "openingGstBalance"
  >[],
  bills: OpeningBillRow[],
  defaultGst: boolean,
) {
  return [...new Set(bills.map((b) => b.partyId))].map((partyId) => {
    const party = parties.find((p) => p.id === partyId);
    if (!party) throw new Error("Opening party not found.");
    const direction = party.type === "customer" ? 1 : -1;
    const rows = bills.filter((b) => b.partyId === partyId);
    return {
      partyId,
      expected: direction * party.openingBalance,
      expectedGst:
        direction *
        (party.openingGstBalance ?? (defaultGst ? party.openingBalance : 0)),
      actual: sumOpeningAmounts(rows.map((r) => r.amount)),
      actualGst: sumOpeningAmounts(rows.map((r) => r.gstAmount)),
    };
  });
}

/** Replace, never append to, the synthetic opening bill when these rows exist. */
export function importedOpeningBills(
  party: Pick<Party, "id">,
  rows: OpeningBill[],
  vouchers: Voucher[],
  asOf: string,
): Bill[] {
  const settled = new Map<string, number>();
  for (const v of vouchers) {
    if (v.status !== "posted" || v.date > asOf) continue;
    for (const a of billAllocations(v))
      settled.set(
        a.voucherId,
        sumOpeningAmounts([settled.get(a.voucherId) ?? 0, a.amount]),
      );
  }
  return rows
    .filter((r) => r.partyId === party.id && r.openingDate <= asOf)
    .map((r) => {
      const id = importedOpeningBillId(r.id);
      const paid = settled.get(id) ?? 0;
      return {
        id,
        number: r.number,
        date: r.date,
        dueDate: r.dueDate,
        amount: r.amount,
        settled: paid,
        pending: Math.max(0, r.amount - paid),
        ageDays: Math.max(0, daysBetween(r.date, asOf)),
        overdueDays: Math.max(0, daysBetween(r.dueDate, asOf)),
      };
    });
}

/** Inputs for the existing cumulative whole-paise opening settlement splitter. */
export function importedOpeningShares(rows: OpeningBill[]) {
  return rows.map(
    (r) =>
      [
        importedOpeningBillId(r.id),
        { total: r.amount, gst: r.gstAmount },
      ] as const,
  );
}

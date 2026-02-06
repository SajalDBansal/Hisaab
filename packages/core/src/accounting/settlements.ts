import type { Allocation, JournalLine, Party, Voucher } from "../types";

export type SettlementVoucher = Voucher & {
  settlementAllocations?: Allocation[];
  settlementKind?: string;
  settlementSourceVoucherId?: string;
};

/** Read-only settlement deltas are separate from original saved bill allocations. */
export function billAllocations(voucher: SettlementVoucher): Allocation[] {
  return [
    ...(voucher.allocations ?? []),
    ...(voucher.settlementAllocations ?? []),
  ];
}

/** Add to ordinary unallocated receipts/payments, then clamp the combined total at zero. */
export function settlementUnallocatedAdjustment(
  partyId: string,
  vouchers: SettlementVoucher[],
): number {
  return sumPaise(
    vouchers
      .filter((v) => v.status === "posted" && v.partyId === partyId)
      .map((v) => {
        let kind = v.settlementKind;
        let sign = 1;
        if (kind === "reversal") {
          kind = vouchers.find(
            (source) => source.id === v.settlementSourceVoucherId,
          )?.settlementKind;
          sign = -1;
        }
        if (kind === "advance-receipt" || kind === "advance-payment")
          return sign * v.amount;
        if (kind === "customer-refund" || kind === "supplier-refund")
          return -sign * v.amount;
        if (kind === "allocation-correction")
          return -sumPaise(
            (v.settlementAllocations ?? []).map((a) => a.amount),
          );
        return 0;
      }),
  );
}

export function sumPaise(values: number[]): number {
  const result = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value))
      throw new Error("Use whole paise within safe limits.");
    return sum + BigInt(value);
  }, 0n);
  const number = Number(result);
  if (!Number.isSafeInteger(number))
    throw new Error("The total exceeds safe limits.");
  return number;
}

export function allocationDelta(
  before: Allocation[],
  after: Allocation[],
): Allocation[] {
  const amounts = new Map<string, number>();
  for (const [rows, sign] of [
    [before, -1],
    [after, 1],
  ] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (
        !Number.isSafeInteger(row.amount) ||
        row.amount <= 0 ||
        seen.has(row.voucherId)
      )
        throw new Error("Use one positive whole-paise allocation per bill.");
      seen.add(row.voucherId);
      amounts.set(
        row.voucherId,
        sumPaise([amounts.get(row.voucherId) ?? 0, sign * row.amount]),
      );
    }
  }
  return [...amounts]
    .filter(([, amount]) => amount !== 0)
    .map(([voucherId, amount]) => ({ voucherId, amount }));
}

export function adjustedAllocations(
  before: Allocation[],
  deltas: Allocation[],
): Allocation[] {
  const amounts = new Map<string, number>();
  for (const row of [...before, ...deltas])
    amounts.set(
      row.voucherId,
      sumPaise([amounts.get(row.voucherId) ?? 0, row.amount]),
    );
  if ([...amounts.values()].some((amount) => amount < 0))
    throw new Error(
      "The correction would release more than this source settled.",
    );
  return [...amounts]
    .filter(([, amount]) => amount > 0)
    .map(([voucherId, amount]) => ({ voucherId, amount }));
}

export function settlementLines(
  kind:
    | "advance-receipt"
    | "advance-payment"
    | "customer-refund"
    | "supplier-refund"
    | "receivable-writeoff"
    | "payable-writeoff"
    | "allocation-correction",
  party: Pick<Party, "id" | "name" | "type">,
  amount: number,
  bank?: { id: string; name: string },
): JournalLine[] {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Enter a positive whole-paise amount.");
  const customer = [
    "advance-receipt",
    "customer-refund",
    "receivable-writeoff",
  ].includes(kind);
  const supplier = [
    "advance-payment",
    "supplier-refund",
    "payable-writeoff",
  ].includes(kind);
  if (
    (customer && party.type !== "customer") ||
    (supplier && party.type !== "supplier")
  )
    throw new Error("This settlement does not match the party type.");
  const partyDebit = [
    "advance-payment",
    "customer-refund",
    "payable-writeoff",
    "allocation-correction",
  ].includes(kind);
  const other =
    kind === "receivable-writeoff"
      ? {
          account: "expense:Bad Debts Written Off",
          name: "Bad Debts Written Off",
        }
      : kind === "payable-writeoff"
        ? {
            account: "income:Payables Written Back",
            name: "Payables Written Back",
          }
        : kind === "allocation-correction"
          ? { account: `party:${party.id}`, name: party.name }
          : bank
            ? { account: `ledger:${bank.id}`, name: bank.name }
            : undefined;
  if (!other) throw new Error("Select a cash or bank account.");
  return [
    {
      account: `party:${party.id}`,
      name: party.name,
      debit: partyDebit ? amount : 0,
      credit: partyDebit ? 0 : amount,
    },
    {
      ...other,
      debit: partyDebit ? 0 : amount,
      credit: partyDebit ? amount : 0,
    },
  ];
}

export function reverseSettlementLines(lines: JournalLine[]): JournalLine[] {
  return lines.map((line) => ({
    ...line,
    debit: line.credit,
    credit: line.debit,
  }));
}

/** Accrued interest is kept outside the principal account; paying it never expenses it twice. */
export function loanInterestLines(
  direction: "borrowed" | "lent",
  kind: "accrual" | "payment",
  amount: number,
  account: { id: string; name: string },
  bank?: { id: string; name: string },
): JournalLine[] {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Enter a positive whole-paise amount.");
  const accrualDebit = direction === "lent";
  const debit = kind === "accrual" ? accrualDebit : !accrualDebit;
  const other =
    kind === "accrual"
      ? direction === "borrowed"
        ? { account: "expense:Interest Paid", name: "Interest Paid" }
        : { account: "income:Interest Received", name: "Interest Received" }
      : bank
        ? { account: `ledger:${bank.id}`, name: bank.name }
        : undefined;
  if (!other) throw new Error("Select a cash or bank account.");
  return [
    {
      account: `account:${account.id}`,
      name: account.name,
      debit: debit ? amount : 0,
      credit: debit ? 0 : amount,
    },
    { ...other, debit: debit ? 0 : amount, credit: debit ? amount : 0 },
  ];
}

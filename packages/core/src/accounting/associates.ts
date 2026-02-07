import type { BookScope, InvoiceLine, JournalLine, Voucher } from "../types";
import { calcLine } from "./invoice";
import { acc } from "./accounts";
import { hasStoredPrecision, isStoredQuantity } from "../precision";

/** Redact private voucher policies in JSON response/cache envelopes, not financial totals. */
export function associatePayloadForRead<T>(role: string | null, payload: T): T {
  if (role === "owner" || role === "accountant") return payload;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const items = value.map(visit);
      return items.some((item, index) => item !== value[index]) ? items : value;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return value;
    const row = value as Record<string, unknown>;
    const voucher =
      typeof row.id === "string" &&
      typeof row.type === "string" &&
      typeof row.number === "string";
    let result = row;
    for (const [key, entry] of Object.entries(row)) {
      if (voucher && key === "commission") {
        if (result === row) result = { ...row };
        delete result[key];
      } else {
        const visible = visit(entry);
        if (visible !== entry) {
          if (result === row) result = { ...row };
          result[key] = visible;
        }
      }
    }
    return result;
  };
  return visit(payload) as T;
}

export interface CommissionPolicy {
  associateId: string;
  name: string;
  ruleVersion: number;
  payableAccountId: string;
  rate: number;
  effectiveFrom: string;
  itemIds: string[];
  groups: string[];
}

export interface CommissionLineSnapshot extends CommissionPolicy {
  lineIndex: number;
  itemId: string;
  quantity: number;
  basis: number;
  earned: number;
}

function integer(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be nonnegative whole paise.`);
  return BigInt(value);
}

function rounded(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n)
    throw new Error("The original quantity must be positive.");
  const value = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(value)) throw new Error("Commission is too large.");
  return value;
}

/** Percentages have three stored decimals; multiplication never uses floating money. */
export function commissionPaise(basis: number, rate: number): number {
  if (!hasStoredPrecision(rate) || rate < 0 || rate > 100)
    throw new Error(
      "Commission rate must be between 0 and 100, with at most 3 decimals.",
    );
  return rounded(
    integer(basis, "Commission basis") * BigInt(Math.round(rate * 1000)),
    100000n,
  );
}

export function commissionLines(
  lines: InvoiceLine[],
  policy: CommissionPolicy,
  itemGroups: ReadonlyMap<string, string>,
): CommissionLineSnapshot[] {
  return lines.flatMap((line, lineIndex) => {
    const restricted = policy.itemIds.length > 0 || policy.groups.length > 0;
    if (
      restricted &&
      !policy.itemIds.includes(line.itemId) &&
      !policy.groups.includes(itemGroups.get(line.itemId) ?? "")
    )
      return [];
    const basis = calcLine(line, false).taxable;
    return [
      {
        ...policy,
        itemIds: [...policy.itemIds],
        groups: [...policy.groups],
        lineIndex,
        itemId: line.itemId,
        quantity: line.qty,
        basis,
        earned: commissionPaise(basis, policy.rate),
      },
    ];
  });
}

/** Round the cumulative returned share, then subtract prior reversals. Full return is exact. */
export function returnedCommission(
  earned: number,
  originalQuantity: number,
  returnedQuantity: number,
): number {
  if (
    !isStoredQuantity(originalQuantity) ||
    originalQuantity <= 0 ||
    !isStoredQuantity(returnedQuantity) ||
    returnedQuantity < 0 ||
    returnedQuantity > originalQuantity
  )
    throw new Error(
      "Returned quantity must be between zero and the original quantity.",
    );
  return rounded(
    integer(earned, "Earned commission") *
      BigInt(Math.round(returnedQuantity * 1000)),
    BigInt(Math.round(originalQuantity * 1000)),
  );
}

export function commissionJournalLines(
  payableAccountId: string,
  name: string,
  amount: number,
  bank?: { id: string; name: string },
): JournalLine[] {
  integer(Math.abs(amount), "Commission");
  if (!amount) return [];
  const payable = {
    account: acc.account(payableAccountId),
    name: `Commission payable - ${name}`,
  };
  const other = bank
    ? { account: acc.ledger(bank.id), name: bank.name }
    : { account: acc.expense("Sales Commission"), name: "Sales Commission" };
  const creditPayable = amount > 0;
  return [
    {
      ...payable,
      debit: creditPayable ? 0 : -amount,
      credit: creditPayable ? amount : 0,
    },
    {
      ...other,
      debit: creditPayable ? amount : 0,
      credit: creditPayable ? 0 : -amount,
    },
  ];
}

export interface CommissionMovement {
  id: string;
  date: string;
  bookScope: BookScope;
  kind: "earned" | "adjustment" | "payout" | "payout-reversal";
  amount: number;
}

export function commissionStatement<T extends CommissionMovement>(
  entries: T[],
  filter: { from?: string; to?: string; scope?: "all" | BookScope } = {},
) {
  const included = entries.filter(
    (e) =>
      (!filter.scope ||
        filter.scope === "all" ||
        e.bookScope === filter.scope) &&
      (!filter.to || e.date <= filter.to),
  );
  const sum = (rows: T[]) => {
    const total = rows.reduce((s, e) => s + BigInt(e.amount), 0n);
    const value = Number(total);
    if (!Number.isSafeInteger(value))
      throw new Error("Statement total is too large.");
    return value;
  };
  const opening = sum(
    included.filter((e) => !!filter.from && e.date < filter.from),
  );
  const rows = included
    .filter((e) => !filter.from || e.date >= filter.from)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const earned = sum(rows.filter((e) => e.kind === "earned"));
  const adjusted = sum(rows.filter((e) => e.kind === "adjustment"));
  const paid = -sum(
    rows.filter((e) => e.kind === "payout" || e.kind === "payout-reversal"),
  );
  return { opening, earned, adjusted, paid, closing: sum(included), rows };
}

/** Notes retain source-line positions even when their own lines are reordered. */
export function returnedQuantityFor(
  saleId: string,
  lineIndex: number,
  notes: Voucher[],
): number {
  const units = notes
    .filter(
      (n) =>
        n.type === "credit-note" &&
        n.status === "posted" &&
        n.againstId === saleId,
    )
    .flatMap((n) => n.lines ?? [])
    .filter((l) => l.sourceLine === lineIndex)
    .reduce((sum, l) => sum + BigInt(Math.round(l.qty * 1000)), 0n);
  return Number(units) / 1000;
}

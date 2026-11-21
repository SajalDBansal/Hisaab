/**
 * Credit control (doc 37, T11). The credit limit always needs an owner's
 * approval to exceed. Overdue bills follow the firm's policy: "off" says
 * nothing, "warn" shows them on the sale form, "block" makes a new sale to that
 * customer need the same owner approval. Edits of existing sales are not
 * blocked for overdue bills; only new invoices are.
 */
import type { ISODate, Party, Voucher } from "../types";
import { collectionBills, overdueSummary } from "./bills";

export const OVERDUE_SALES_POLICIES = ["off", "warn", "block"] as const;
export type OverdueSalesPolicy = (typeof OVERDUE_SALES_POLICIES)[number];
export const DEFAULT_OVERDUE_SALES_POLICY: OverdueSalesPolicy = "warn";

/**
 * The customer's overdue bills as of `asOf`, ignoring the sales being saved
 * (a back-dated sale is not overdue against itself). On-account money is
 * set against the oldest bills first, as everywhere else.
 */
export function overdueBeforeSale(
  party: Party,
  vouchers: Voucher[],
  asOf: ISODate,
  saleIds: Iterable<string> = [],
) {
  const skip = new Set(saleIds);
  return overdueSummary(
    collectionBills(party, vouchers, asOf).filter((b) => !skip.has(b.id)),
  );
}

/** Why a new sale needs an owner's approval, or null. */
export function creditApprovalReason(input: {
  creditLimit: number;
  balanceAfter: number;
  overdueAmount: number;
  policy: OverdueSalesPolicy;
  newSale: boolean;
}): "limit" | "overdue" | null {
  if (input.creditLimit > 0 && input.balanceAfter > input.creditLimit)
    return "limit";
  if (input.newSale && input.policy === "block" && input.overdueAmount > 0)
    return "overdue";
  return null;
}

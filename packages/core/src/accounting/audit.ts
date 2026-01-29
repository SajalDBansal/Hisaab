/**
 * Edit history (audit trail): what changed on a voucher, in words people can read.
 * Indian company law (Companies (Accounts) Rules, Rule 3(1)) asks accounting software to log
 * every change with its date, and the log can't be switched off. The app has no switch for it.
 */
import { formatDate } from "../dates";
import { formatINR } from "../money";
import type { AuditAction, AuditChange, Voucher } from "../types";

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  created: "Created",
  edited: "Edited",
  cancelled: "Cancelled",
  converted: "Converted",
  reopened: "Reopened",
  "bank-date": "Bank date",
};

/** Names the diff needs: party and item names by id. */
export interface AuditNames {
  party: (id?: string) => string;
  item: (id: string) => string;
}

/** The parts of a voucher a person would care about, as text. */
function describe(v: Voucher, names: AuditNames): Record<string, string> {
  const lines = (v.lines ?? [])
    .map(
      (l) =>
        `${names.item(l.itemId)} × ${l.qty}${l.per ? ` ${l.per.unit}` : ""} @ ${formatINR(l.rate)}`,
    )
    .join("; ");
  const charges = (v.charges ?? [])
    .map((c) => `${c.name} ${formatINR(c.amount)}`)
    .join("; ");
  return {
    Date: formatDate(v.date),
    Party: v.partyId ? names.party(v.partyId) : "",
    Amount: formatINR(v.amount),
    Items: lines,
    Charges: charges,
    "Supplier bill no.": v.supplierInvoiceNo ?? "",
    "Valid until": v.validUntil ? formatDate(v.validUntil) : "",
    Note: v.narration ?? "",
    Reference: v.reference ?? "",
  };
}

/** Fields that differ between two versions of a voucher. */
export function voucherChanges(
  before: Voucher,
  after: Voucher,
  names: AuditNames,
): AuditChange[] {
  const a = describe(before, names);
  const b = describe(after, names);
  return Object.keys(a)
    .filter((k) => a[k] !== b[k])
    .map((k) => ({ field: k, before: a[k] || "—", after: b[k] || "—" }));
}

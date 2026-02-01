/** Display text for codes stored in the data (voucher types, payment modes, statuses). */
import {
  formatINR,
  stateName as coreStateName,
  type DocumentKind,
  type PaymentMode,
  type Voucher,
  type VoucherType,
} from "@repo/core";
import type { Href } from "expo-router";
import type { BadgeTone, IconName } from "@/components";

export const APP_NAME = "Hisaab";

export const voucherTypeLabel: Record<VoucherType, string> = {
  sale: "Sale",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  expense: "Expense",
  journal: "Journal",
  "credit-note": "Credit note",
  "debit-note": "Debit note",
  contra: "Contra",
  estimate: "Estimate",
  "sales-order": "Sales order",
  "delivery-note": "Delivery challan",
  "purchase-order": "Purchase order",
};

export const voucherTypeIcon: Record<VoucherType, IconName> = {
  sale: "file-text",
  purchase: "shopping-cart",
  receipt: "arrow-down-left",
  payment: "arrow-up-right",
  expense: "credit-card",
  journal: "book",
  "credit-note": "corner-up-left",
  "debit-note": "corner-up-right",
  contra: "repeat",
  estimate: "clipboard",
  "sales-order": "check-square",
  "delivery-note": "truck",
  "purchase-order": "package",
};

/** Short version for list rows. */
export const paymentModeShort: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank",
  cheque: "Cheque",
  card: "Card",
};

export const paymentModeLabel: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "NEFT / RTGS / IMPS",
  cheque: "Cheque",
  card: "Card",
};

/** The badge shown next to a voucher in lists. */
export function voucherBadge(
  v: Voucher,
): { label: string; tone: BadgeTone } | null {
  if (v.status === "draft") return { label: "Draft", tone: "dashed" };
  if (v.status === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (v.pendingSync) return { label: "Pending sync", tone: "dashed" };
  return null;
}

/** "₹1,200.00 Dr" / "₹1,200.00 Cr" for an account balance (Dr positive). */
export function drCr(balance: number, decimals = true): string {
  if (balance === 0) return "Nil";
  return `${formatINR(Math.abs(balance), { decimals })} ${balance > 0 ? "Dr" : "Cr"}`;
}

/** "09" → "09 · Uttar Pradesh" for compact tables. */
export const stateName = (code: string) =>
  code ? `${code} · ${coreStateName(code)}` : "—";

/** Link to an account statement. Keys contain ":" and spaces, so encode them. */
export const accountHref = (key: string): Href =>
  `/account/${encodeURIComponent(key)}` as Href;

export const documentKindLabel: Record<DocumentKind, string> = {
  bill: "Bill",
  receipt: "Receipt",
  certificate: "Certificate",
  agreement: "Agreement",
  other: "Other",
};

/** Image files get a picture icon, everything else a page. */
export const documentIcon = (name: string): IconName =>
  /\.(jpe?g|png|heic|webp)$/i.test(name) ? "image" : "file-text";

/** 640 → "640 KB", 1240 → "1.2 MB" */
export const fileSize = (kb: number) =>
  kb >= 1000 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

/** Paise → text for an amount field: 16500 → "165", 0 → "". */
export const toRupeeText = (paise: number) =>
  paise ? String(paise / 100) : "";

/** Status badge for estimates and orders. */
export const orderStatusBadge: Record<
  "open" | "partial" | "converted" | "expired" | "cancelled",
  { label: string; tone: BadgeTone }
> = {
  open: { label: "Open", tone: "neutral" },
  partial: { label: "Part fulfilled", tone: "warn" },
  converted: { label: "Converted", tone: "ok" },
  expired: { label: "Expired", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

/**
 * The firm's GST mode and what it changes. GST in Hisaab is for working out bills
 * and reports only — nothing is sent to the GST portal.
 *
 *              Sales                          Purchases                    Reports
 * regular      Tax invoice, GST charged       GST is input tax (ITC)       GSTR-1, GSTR-3B
 * composition  Bill of supply, no GST         GST paid is part of cost     CMP-08: flat % of turnover
 * off          Invoice, no GST                No GST at all                none
 */
import { addDays, yearMonth } from "../dates";
import type {
  CompositionType,
  Firm,
  GstMode,
  InvoiceLine,
  ISODate,
  Paise,
  SaleDocType,
  Voucher,
  VoucherType,
} from "../types";
import { isPosted } from "./bills";
import { calcInvoice } from "./invoice";
import { saleDocType } from "./taxType";

export const gstModeOf = (firm: Pick<Firm, "gstRegistration">): GstMode =>
  firm.gstRegistration === "unregistered" ? "off" : firm.gstRegistration;

/** Mode a voucher was saved under (older vouchers: regular). */
export const voucherMode = (v: Pick<Voucher, "taxMode">): GstMode =>
  v.taxMode ?? "regular";

export const GST_MODES: { value: GstMode; label: string; note: string }[] = [
  {
    value: "regular",
    label: "Regular",
    note: "Charge GST on sales, claim GST paid on purchases",
  },
  {
    value: "composition",
    label: "Composition",
    note: "No GST on bills; pay a flat % of sales every quarter",
  },
  {
    value: "off",
    label: "No GST",
    note: "Not registered: GST is switched off in the app",
  },
];

export const gstModeLabel = (m: GstMode) =>
  GST_MODES.find((x) => x.value === m)!.label;

export const COMPOSITION_TYPES: {
  value: CompositionType;
  label: string;
  rate: number;
}[] = [
  { value: "trader", label: "Trader or manufacturer", rate: 1 },
  { value: "restaurant", label: "Restaurant", rate: 5 },
  { value: "services", label: "Other services", rate: 6 },
];

/** Composition tax rate in % (1, 5 or 6). */
export const compositionRate = (t: CompositionType = "trader") =>
  COMPOSITION_TYPES.find((x) => x.value === t)!.rate;

/** Printed on every composition bill of supply (Rule 5 of the CGST invoice rules). */
export const COMPOSITION_DECLARATION =
  "Composition taxable person, not eligible to collect tax on supplies";
/** Printed on bills of a firm without GST. */
export const NO_GST_NOTE =
  "GST not applicable: the business is not registered under GST.";

export type Side = "sale" | "purchase";

/** Which side of trade a voucher is on: sales, returns from customers and customer orders vs purchases. */
export function sideOf(type: VoucherType): Side | null {
  if (
    [
      "sale",
      "credit-note",
      "estimate",
      "sales-order",
      "delivery-note",
    ].includes(type)
  )
    return "sale";
  if (["purchase", "debit-note", "purchase-order"].includes(type))
    return "purchase";
  return null;
}

/**
 * Is GST put on bills of this side?
 * Composition firms pay GST to their suppliers (it shows on the purchase bill)
 * but never charge it to customers. Firms without GST ignore it on both sides.
 */
export const billsCarryGst = (mode: GstMode, side: Side) =>
  mode === "regular" || (mode === "composition" && side === "purchase");

/** Only regular firms can take credit for GST paid on purchases. */
export const claimsInputTax = (mode: GstMode) => mode === "regular";

/** The firm shows GST rates, HSN and GSTINs at all. */
export const usesGst = (mode: GstMode) => mode !== "off";

/** Take GST off lines and charges when this side doesn't carry it (the item's tax type is kept). */
export function applyGstMode<T extends { gstRate: number }>(
  rows: T[],
  mode: GstMode,
  side: Side,
): T[] {
  return billsCarryGst(mode, side)
    ? rows
    : rows.map((r) => ({ ...r, gstRate: 0 as T["gstRate"] }));
}

/** Kind of sale document for the firm's mode. */
export function saleDocFor(mode: GstMode, lines: InvoiceLine[]): SaleDocType {
  if (mode === "composition") return "bill-of-supply";
  if (mode === "off") return "invoice";
  return saleDocType(lines);
}

/** Why a sale can't be saved under this mode, or null. Composition firms can't sell goods to another state. */
export function modeBlocker(
  mode: GstMode,
  side: Side,
  interState: boolean,
): string | null {
  if (mode === "composition" && side === "sale" && interState)
    return "A composition firm can't sell to another state. Pick a party in your state, or change the GST setting in Firm profile.";
  return null;
}

// ---------------------------------------------------------------------------
// Composition: CMP-08 (quarterly) — tax = rate × turnover
// ---------------------------------------------------------------------------

export interface CompositionQuarter {
  /** e.g. "2026-07" … "2026-09" */
  months: string[];
  label: string;
  /** Sales minus sales returns, posted bills only (value of the bills; no GST is on them). */
  turnover: Paise;
  sales: Paise;
  returns: Paise;
  rate: number;
  tax: Paise;
  /** CMP-08 is due on the 18th of the month after the quarter. */
  due: ISODate;
}

const QUARTER_NAMES = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];

/** The quarter (Apr–Jun …) that `date` falls in. */
export function quarterOf(date: ISODate): { months: string[]; label: string } {
  const m = Number(date.slice(5, 7));
  const y = Number(date.slice(0, 4));
  const startMonth = [4, 7, 10, 1][Math.floor(((m + 8) % 12) / 3)];
  const months = [0, 1, 2].map((i) => {
    const mm = startMonth + i;
    return `${y}-${String(mm).padStart(2, "0")}`;
  });
  return {
    months,
    label: `${QUARTER_NAMES[[4, 7, 10, 1].indexOf(startMonth)]} ${y}`,
  };
}

export function compositionQuarter(
  vouchers: Voucher[],
  date: ISODate,
  type: CompositionType = "trader",
): CompositionQuarter {
  const { months, label } = quarterOf(date);
  const inQuarter = (v: Voucher) =>
    isPosted(v) &&
    voucherMode(v) === "composition" &&
    months.includes(yearMonth(v.date));
  const value = (v: Voucher) =>
    calcInvoice({ lines: v.lines ?? [], charges: v.charges, interState: false })
      .taxable;
  const sales = vouchers
    .filter((v) => v.type === "sale" && inQuarter(v))
    .reduce((s, v) => s + value(v), 0);
  const returns = vouchers
    .filter((v) => v.type === "credit-note" && inQuarter(v))
    .reduce((s, v) => s + value(v), 0);
  const rate = compositionRate(type);
  const turnover = sales - returns;
  const last = months[2];
  return {
    months,
    label,
    turnover,
    sales,
    returns,
    rate,
    tax: Math.round((Math.max(turnover, 0) * rate) / 100),
    due: addDays(`${last}-01`, 31).slice(0, 8) + "18",
  };
}

/**
 * GST and non-GST goods on bills: classification, mixing rules, splitting and report filters.
 *
 * Rules (see README):
 *   - Taxable, nil-rated and exempt goods may share one bill.
 *   - Non-GST goods (petrol, liquor …) must be on a bill of their own.
 *   - A sale with no taxable line is a "Bill of supply", otherwise a "Tax invoice".
 */
import type {
  InvoiceLine,
  Item,
  SaleDocType,
  TaxScope,
  TaxType,
  Voucher,
} from "../types";

export const TAX_TYPES: { value: TaxType; label: string; note: string }[] = [
  { value: "taxable", label: "Taxable", note: "GST at 5, 18 or 40%" },
  { value: "nil", label: "Nil-rated", note: "GST at 0%, e.g. salt" },
  {
    value: "exempt",
    label: "Exempt",
    note: "No GST, e.g. fresh milk, loose atta",
  },
  {
    value: "nongst",
    label: "Non-GST",
    note: "Outside GST, e.g. petrol, liquor — billed separately",
  },
];

export const taxTypeLabel = (t: TaxType) =>
  TAX_TYPES.find((x) => x.value === t)!.label;

/** Tax type of an item; old data without one counts as taxable, or nil at 0%. */
export function itemTaxType(
  item: Pick<Item, "gstRate"> & { taxType?: TaxType },
): TaxType {
  return item.taxType ?? (item.gstRate === 0 ? "nil" : "taxable");
}

/** Tax type of a bill line (saved on the line; older lines fall back to the rate). */
export function lineTaxType(line: InvoiceLine): TaxType {
  return line.taxType ?? (line.gstRate === 0 ? "nil" : "taxable");
}

/** Which report filter an item or line falls in: GST only when GST is charged on it. */
export const scopeOf = (t: TaxType): "gst" | "nongst" =>
  t === "taxable" ? "gst" : "nongst";

export function itemInScope(
  item: Pick<Item, "gstRate"> & { taxType?: TaxType },
  scope: TaxScope,
): boolean {
  return scope === "all" || scopeOf(itemTaxType(item)) === scope;
}

export function lineInScope(line: InvoiceLine, scope: TaxScope): boolean {
  return (
    scope === "all" || (line.bookScope ?? scopeOf(lineTaxType(line))) === scope
  );
}

/** A sale or purchase bill is "GST" if any line has GST, otherwise "Non-GST". Other vouchers: null. */
export function voucherScope(v: Voucher): "gst" | "nongst" | null {
  if (v.bookScope) return v.bookScope;
  if (v.type !== "sale" && v.type !== "purchase") return null;
  return (v.lines ?? []).some((l) => lineTaxType(l) === "taxable")
    ? "gst"
    : "nongst";
}

/** For bill lists: All shows everything; GST / Non-GST show only sale and purchase bills of that kind. */
export function voucherInScope(v: Voucher, scope: TaxScope): boolean {
  return scope === "all" || voucherScope(v) === scope;
}

/** Tax invoice when any line carries GST, otherwise bill of supply. */
export function saleDocType(lines: InvoiceLine[]): SaleDocType {
  return lines.some((l) => lineTaxType(l) === "taxable")
    ? "tax-invoice"
    : "bill-of-supply";
}

export const docTypeLabel = (d: SaleDocType) =>
  d === "tax-invoice"
    ? "Tax invoice"
    : d === "bill-of-supply"
      ? "Bill of supply"
      : "Invoice";

/** True when non-GST goods are on the same bill as GST goods (taxable, nil or exempt). */
export function mixesNonGst(lines: InvoiceLine[]): boolean {
  const non = lines.filter((l) => lineTaxType(l) === "nongst").length;
  return non > 0 && non < lines.length;
}

/** Split a bill's lines into the GST part (taxable, nil, exempt) and the non-GST part. */
export function splitNonGst(lines: InvoiceLine[]): {
  gst: InvoiceLine[];
  nonGst: InvoiceLine[];
} {
  return {
    gst: lines.filter((l) => lineTaxType(l) !== "nongst"),
    nonGst: lines.filter((l) => lineTaxType(l) === "nongst"),
  };
}

export const NON_GST_MIX_MESSAGE = "Non-GST goods must be on a separate bill.";
/** A supplier without a GSTIN can't charge GST, so its bill can't claim GST either. */
export const UNREGISTERED_SUPPLIER_GST_MESSAGE =
  "This supplier has no GSTIN, so the bill can't carry GST. Add the supplier's GSTIN, or turn on Purchase without GST.";

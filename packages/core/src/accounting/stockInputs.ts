import type { ISODate, InvoiceLine, Voucher } from "../types";
import { isPosted } from "./bills";

/** Convert a packed quantity into base units, retaining three decimal places. */
export function baseQty(line: InvoiceLine): number {
  return Math.round(line.qty * (line.per?.factor ?? 1) * 1000) / 1000;
}

/** A later invoice must not erase a delivery note from an earlier stock report. */
export function stockVouchersAsOf(
  vouchers: Voucher[],
  asOf: ISODate,
): Voucher[] {
  const dated = vouchers.filter((v) => v.date <= asOf);
  const posted = new Set(dated.filter(isPosted).map((v) => v.id));
  return dated.map((v) =>
    v.type === "delivery-note" &&
    v.convertedToId &&
    !posted.has(v.convertedToId)
      ? { ...v, convertedToId: undefined }
      : v,
  );
}

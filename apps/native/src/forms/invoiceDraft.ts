import {
  itemTaxType,
  parseRupees,
  type BookScope,
  type ExtraCharge,
  type InvoiceLine,
  type Item,
  type Voucher,
} from "@repo/core";

/** Text being edited, with the issued basis retained for existing lines. */
export interface LineDraft {
  key: number;
  stockLotId?: string;
  itemId: string;
  qty: string;
  rate: string;
  discountPercent: string;
  discountAmount?: string;
  inAlt: boolean;
  saved?: InvoiceLine;
}

export function invoiceDrafts(voucher: Voucher, editing: boolean): LineDraft[] {
  return (voucher.lines ?? []).map((line, index) => ({
    key: index + 1,
    stockLotId: line.stockLotId,
    itemId: line.itemId,
    qty: String(line.qty),
    rate: (line.rate / 100).toFixed(2),
    discountPercent: line.discountPercent ? String(line.discountPercent) : "",
    discountAmount:
      line.discountAmount === undefined
        ? undefined
        : (line.discountAmount / 100).toFixed(2),
    inAlt: !!line.per,
    saved: editing ? line : undefined,
  }));
}

/** An existing item's issued master is also used by the server when editing this invoice. */
export function invoiceDraftItem(
  itemId: string,
  current: Item | undefined,
  editing?: Voucher,
) {
  return editing?.snapshot?.items.find((item) => item.id === itemId) ?? current;
}

export function invoiceDraftUnit(draft: LineDraft, item?: Item) {
  return (
    draft.saved?.per ??
    (item?.altUnit
      ? { unit: item.altUnit.name, factor: item.altUnit.factor }
      : undefined)
  );
}

/** Preserve saved packing and tax details; only fresh rows use today's item values. */
export function invoiceDraftLine(
  draft: LineDraft,
  item: Item | undefined,
  scope?: BookScope,
): InvoiceLine {
  const saved =
    draft.saved?.stockLotId === draft.stockLotId ? draft.saved : undefined;
  const bookScope = scope ?? saved?.bookScope;
  const taxType =
    bookScope === "nongst"
      ? "nongst"
      : saved
        ? (saved.taxType ?? (saved.gstRate ? "taxable" : "nil"))
        : item
          ? itemTaxType(item)
          : "taxable";
  return {
    stockLotId: draft.stockLotId,
    bookScope,
    itemId: draft.itemId,
    qty: Number(draft.qty) || 0,
    rate: parseRupees(draft.rate) ?? 0,
    discountPercent:
      draft.discountAmount === undefined
        ? Number(draft.discountPercent) || undefined
        : undefined,
    discountAmount:
      draft.discountAmount === undefined
        ? undefined
        : (parseRupees(draft.discountAmount) ?? 0),
    gstRate: taxType === "taxable" ? (saved?.gstRate ?? item?.gstRate ?? 0) : 0,
    taxType,
    per: draft.inAlt ? invoiceDraftUnit(draft, item) : undefined,
    // The server saves new and edited lines with exact maths; preview the same totals.
    exactMath: true,
  };
}

/** Editing freight must not replace its old GST rate or discard other issued charges. */
export function invoiceDraftCharges(
  freight: number,
  saved: ExtraCharge[] = [],
): ExtraCharge[] {
  const index = saved.findIndex((charge) => charge.name === "Freight");
  const charges = saved.flatMap((charge, position) =>
    position !== index
      ? [{ ...charge }]
      : freight > 0
        ? [{ ...charge, amount: freight }]
        : [],
  );
  if (index < 0 && freight > 0)
    charges.push({ name: "Freight", amount: freight, gstRate: 18 });
  return charges;
}

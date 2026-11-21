import {
  allocateBillDiscount,
  chargeHeadAccount,
  splitBillDiscount,
  type BillDiscountInput,
  type ChargeHead,
  baseQty,
  itemTaxType,
  parseRupees,
  thousandths,
  type BookScope,
  type StockLot,
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
  /** Purchases of goods: batch bought and its expiry (doc 37, T38). */
  batchNumber?: string;
  expiryDate?: string;
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
    batchNumber: line.batchNumber,
    expiryDate: line.expiryDate,
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
    batchNumber: draft.batchNumber?.trim() || undefined,
    expiryDate: draft.expiryDate || undefined,
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

/** Lots as they stood before this bill took its stock, so an edit can reuse it. */
export function lotsWithoutBill(lots: StockLot[], bill?: Voucher): StockLot[] {
  if (!bill) return lots;
  return lots.map((lot) => {
    const own = (bill.lines ?? []).filter((l) => l.stockLotId === lot.id);
    if (!own.length) return lot;
    const qty =
      own.reduce((n, l) => n + thousandths(baseQty(l)), thousandths(lot.qty)) /
      1000;
    const value = own.reduce((n, l) => n + (l.stockCost ?? 0), lot.value);
    return { ...lot, qty, value, unitCost: qty ? value / qty : lot.unitCost };
  });
}

/** Which stock rows each entered line became (allocation returns them in order). */
export function stockPartsByLine(
  entered: InvoiceLine[],
  parts: InvoiceLine[],
): InvoiceLine[][] {
  let next = 0;
  return entered.map((line) => {
    const wanted = thousandths(baseQty(line));
    const mine: InvoiceLine[] = [];
    let got = 0;
    while (next < parts.length && (!mine.length || got < wanted)) {
      got += thousandths(baseQty(parts[next]));
      mine.push(parts[next++]);
    }
    return mine;
  });
}

/**
 * Preview of the subtotal discount (doc 37, T09) the way the server saves it:
 * a sale with GST and non-GST stock becomes two bills that share it by value.
 * Lines keep their order so each entered row still finds its stock parts.
 */
export function withBillDiscount(
  lines: InvoiceLine[],
  input: BillDiscountInput | undefined,
  byScope: boolean,
): InvoiceLine[] {
  const scopes = byScope
    ? (["gst", "nongst"] as const).filter((s) =>
        lines.some((l) => l.bookScope === s),
      )
    : [undefined];
  const groups = scopes.map((scope) =>
    lines.flatMap((line, index) =>
      scope === undefined || line.bookScope === scope ? [{ line, index }] : [],
    ),
  );
  const parts = splitBillDiscount(
    input,
    groups.map((g) => g.map((r) => r.line)),
  );
  const out = [...lines];
  groups.forEach((group, i) => {
    const shared = allocateBillDiscount(
      group.map((r) => r.line),
      parts[i],
    ).lines;
    group.forEach((r, j) => (out[r.index] = shared[j]));
  });
  return out;
}

/** Charges picked from the firm's charge heads; an edit keeps what the bill froze. */
export function headCharges(
  amounts: Record<string, number>,
  heads: ChargeHead[] = [],
  side: "sale" | "purchase",
  saved: ExtraCharge[] = [],
): ExtraCharge[] {
  return Object.entries(amounts).flatMap(([headId, amount]) => {
    if (!(amount > 0)) return [];
    const frozen = saved.find((c) => c.headId === headId);
    if (frozen) return [{ ...frozen, amount }];
    const head = heads.find((h) => h.id === headId);
    if (!head) return [];
    return [
      {
        name: head.name,
        amount,
        gstRate: head.taxType === "taxable" ? head.gstRate : 0,
        headId,
        taxType: head.taxType,
        sac: head.sac,
        account: chargeHeadAccount(head, side),
      },
    ];
  });
}

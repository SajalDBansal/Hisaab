/**
 * Invoice maths: line totals, GST split, round-off.
 * Pure functions — same input always gives the same output, no side effects.
 */
import type { ExtraCharge, GstRate, InvoiceLine, Paise } from "../types";

export interface LineTotals {
  /** qty × rate */
  gross: Paise;
  discount: Paise;
  /** gross − discount, the value GST is charged on */
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  /** cgst + sgst + igst */
  tax: Paise;
  /** taxable + tax */
  total: Paise;
}

export interface RateBreakup {
  rate: GstRate;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  charges: LineTotals[];
  /** Taxable value of item lines only (goes to the Sales/Purchase ledger). */
  itemsTaxable: Paise;
  /** Taxable value of items + charges. */
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  tax: Paise;
  /** Before rounding to the nearest rupee. */
  totalBeforeRound: Paise;
  /** Invoice rupee rounding, or the original rounding allocated to a return. */
  roundOff: Paise;
  /** Invoice total in whole rupees; cumulative returns may include paise. */
  grandTotal: Paise;
  /** Tax summary per GST rate, for the invoice footer and GSTR-1. */
  byRate: RateBreakup[];
}

/** GST on a taxable value. Same state → CGST + SGST (half each). Other state → IGST. */
export function calcTax(taxable: Paise, rate: GstRate, interState: boolean) {
  if (interState) {
    const igst = Math.round((taxable * rate) / 100);
    return { cgst: 0, sgst: 0, igst };
  }
  const half = Math.round((taxable * rate) / 200);
  return { cgst: half, sgst: half, igst: 0 };
}

export function calcLine(line: InvoiceLine, interState: boolean): LineTotals {
  if (line.returnAmounts) {
    const { taxable, discount, cgst, sgst, igst } = line.returnAmounts;
    const tax = cgst + sgst + igst;
    return {
      gross: taxable + discount,
      discount,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total: taxable + tax,
    };
  }
  const gross = Math.round(line.qty * line.rate);
  let discount = 0;
  if (line.discountPercent)
    discount = Math.round((gross * line.discountPercent) / 100);
  else if (line.discountAmount) discount = line.discountAmount;
  discount = Math.min(Math.max(discount, 0), gross);
  const taxable = gross - discount;
  const { cgst, sgst, igst } = calcTax(taxable, line.gstRate, interState);
  const tax = cgst + sgst + igst;
  return {
    gross,
    discount,
    taxable,
    cgst,
    sgst,
    igst,
    tax,
    total: taxable + tax,
  };
}

export function calcCharge(
  charge: ExtraCharge,
  interState: boolean,
): LineTotals {
  const taxable = charge.amount;
  const { cgst, sgst, igst } = calcTax(taxable, charge.gstRate, interState);
  const tax = cgst + sgst + igst;
  return {
    gross: taxable,
    discount: 0,
    taxable,
    cgst,
    sgst,
    igst,
    tax,
    total: taxable + tax,
  };
}

/** Round to the nearest whole rupee (100 paise). */
export function roundToRupee(paise: Paise): Paise {
  return Math.round(paise / 100) * 100;
}

export function calcInvoice(input: {
  lines: InvoiceLine[];
  charges?: ExtraCharge[];
  interState: boolean;
}): InvoiceTotals {
  const { interState } = input;
  const lines = input.lines.map((l) => calcLine(l, interState));
  const chargeList = input.charges ?? [];
  const charges = chargeList.map((c) => calcCharge(c, interState));
  const all = [...lines, ...charges];

  const sum = (key: keyof LineTotals) =>
    all.reduce((acc, t) => acc + t[key], 0);
  const itemsTaxable = lines.reduce((acc, t) => acc + t.taxable, 0);
  const taxable = sum("taxable");
  const cgst = sum("cgst");
  const sgst = sum("sgst");
  const igst = sum("igst");
  const tax = cgst + sgst + igst;
  const totalBeforeRound = taxable + tax;
  const savedReturn = input.lines.some((line) => line.returnAmounts);
  if (
    savedReturn &&
    (chargeList.length || input.lines.some((line) => !line.returnAmounts))
  )
    throw new Error(
      "Return amounts must cover every goods line without charges.",
    );
  const grandTotal = savedReturn
    ? totalBeforeRound +
      input.lines.reduce((sum, line) => sum + line.returnAmounts!.roundOff, 0)
    : roundToRupee(totalBeforeRound);

  // Group tax by rate (items and charges together)
  const rates = [
    ...input.lines.map((l) => l.gstRate),
    ...chargeList.map((c) => c.gstRate),
  ];
  const map = new Map<GstRate, RateBreakup>();
  all.forEach((t, i) => {
    const rate = rates[i];
    const row = map.get(rate) ?? {
      rate,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
    };
    row.taxable += t.taxable;
    row.cgst += t.cgst;
    row.sgst += t.sgst;
    row.igst += t.igst;
    map.set(rate, row);
  });
  const byRate = [...map.values()].sort((a, b) => a.rate - b.rate);

  return {
    lines,
    charges,
    itemsTaxable,
    taxable,
    cgst,
    sgst,
    igst,
    tax,
    totalBeforeRound,
    roundOff: grandTotal - totalBeforeRound,
    grandTotal,
    byRate,
  };
}

/**
 * Invoice maths: line totals, GST split, round-off.
 * Pure functions — same input always gives the same output, no side effects.
 */
import { mulDivRound, thousandths } from "../money";
import type {
  BillDiscount,
  BillDiscountInput,
  ExtraCharge,
  GstRate,
  InvoiceLine,
  Paise,
} from "../types";

export interface LineTotals {
  /** qty × rate */
  gross: Paise;
  discount: Paise;
  /** This line's share of the subtotal discount (doc 37, T09). */
  billDiscount: Paise;
  /** gross − discount − billDiscount, the value GST is charged on */
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
  /** Subtotal discount spread over the lines (already out of `itemsTaxable`). */
  billDiscount: Paise;
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

/** qty × rate in paise. Older lines keep the floating-point total they were issued with. */
export function lineGross(
  line: Pick<InvoiceLine, "qty" | "rate" | "exactMath">,
) {
  return line.exactMath
    ? mulDivRound(thousandths(line.qty), line.rate, 1000)
    : Math.round(line.qty * line.rate);
}

export function calcLine(line: InvoiceLine, interState: boolean): LineTotals {
  if (line.returnAmounts) {
    const { taxable, discount, cgst, sgst, igst } = line.returnAmounts;
    const tax = cgst + sgst + igst;
    return {
      gross: taxable + discount,
      discount,
      billDiscount: 0,
      taxable,
      cgst,
      sgst,
      igst,
      tax,
      total: taxable + tax,
    };
  }
  const gross = lineGross(line);
  let discount = 0;
  if (line.discountPercent)
    discount = line.exactMath
      ? mulDivRound(gross, thousandths(line.discountPercent), 100_000)
      : Math.round((gross * line.discountPercent) / 100);
  else if (line.discountAmount) discount = line.discountAmount;
  discount = Math.min(Math.max(discount, 0), gross);
  const billDiscount = Math.min(
    Math.max(line.billDiscountShare ?? 0, 0),
    gross - discount,
  );
  const taxable = gross - discount - billDiscount;
  const { cgst, sgst, igst } = calcTax(taxable, line.gstRate, interState);
  const tax = cgst + sgst + igst;
  return {
    gross,
    discount,
    billDiscount,
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
    billDiscount: 0,
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
  const billDiscount = lines.reduce((acc, t) => acc + t.billDiscount, 0);
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
    billDiscount,
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

// ---------------------------------------------------------------------------
// Subtotal discount and tax-inclusive rates (doc 37, T09)
// ---------------------------------------------------------------------------

/** Split `amount` over `weights` in whole paise (largest remainder, ties to the earlier row). */
export function apportion(amount: Paise, weights: Paise[]): Paise[] {
  const total = weights.reduce((sum, w) => sum + Math.max(w, 0), 0);
  if (!total || amount <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => BigInt(Math.max(w, 0)) * BigInt(amount));
  const shares = exact.map((p) => Number(p / BigInt(total)));
  let left = amount - shares.reduce((sum, s) => sum + s, 0);
  const order = exact
    .map((p, index) => ({ index, rest: p % BigInt(total) }))
    .sort((a, b) =>
      b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.index - b.index,
    );
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

/** A line's value after its own discount: what a subtotal discount is spread over. */
const valueBeforeBillDiscount = (line: InvoiceLine) =>
  calcLine({ ...line, billDiscountShare: undefined }, false).taxable;

/**
 * Spread a subtotal discount over the goods lines in proportion to their value
 * after line discounts, so GST is charged on the discounted value.
 * A percentage is taken of the whole subtotal first (rounded to the paisa, half up)
 * and that amount is spread; an amount is capped at the subtotal.
 * Without a discount, any old shares are removed.
 */
export function allocateBillDiscount(
  lines: InvoiceLine[],
  input?: BillDiscountInput,
): { lines: InvoiceLine[]; billDiscount?: BillDiscount } {
  const plain = lines.map((line) => {
    const { billDiscountShare: _share, ...rest } = line;
    return rest as InvoiceLine;
  });
  const percent = input?.percent ?? 0;
  const wanted = input?.amount ?? 0;
  if (percent <= 0 && wanted <= 0) return { lines: plain };
  if (percent > 100) throw new Error("A discount can't be more than 100%.");
  if (plain.some((line) => line.returnAmounts))
    throw new Error("A return can't carry its own subtotal discount.");
  const values = plain.map(valueBeforeBillDiscount);
  const subtotal = values.reduce((sum, v) => sum + v, 0);
  const amount =
    percent > 0
      ? mulDivRound(subtotal, thousandths(percent), 100_000)
      : Math.min(wanted, subtotal);
  if (amount <= 0) return { lines: plain };
  const shares = apportion(amount, values);
  return {
    lines: plain.map((line, i) =>
      shares[i] ? { ...line, billDiscountShare: shares[i] } : line,
    ),
    billDiscount: percent > 0 ? { percent, amount } : { amount },
  };
}

/**
 * The same subtotal discount for a bill saved as several bills (GST and non-GST
 * stock): a percentage applies to each; an amount is shared by their values.
 */
export function splitBillDiscount(
  input: BillDiscountInput | undefined,
  groups: InvoiceLine[][],
): (BillDiscountInput | undefined)[] {
  if (!input || (!input.percent && !input.amount))
    return groups.map(() => undefined);
  if (input.percent) return groups.map(() => ({ percent: input.percent }));
  const values = groups.map((g) =>
    g.reduce((sum, line) => sum + valueBeforeBillDiscount(line), 0),
  );
  const total = values.reduce((sum, v) => sum + v, 0);
  return apportion(Math.min(input.amount ?? 0, total), values).map((amount) =>
    amount ? { amount } : undefined,
  );
}

/**
 * Rate before GST from a GST-inclusive rate typed by the user:
 * inclusive × 100 ÷ (100 + GST%), to the nearest paisa (half up).
 * Lines store this exclusive rate, so qty × rate + GST can differ from
 * qty × the typed rate by a few paise; the bill total is still rounded to the rupee.
 */
export function exclusiveRate(inclusive: Paise, gstRate: number): Paise {
  return mulDivRound(inclusive, 100, 100 + gstRate);
}

/** GST-inclusive rate shown for an exclusive rate (nearest paisa, half up). */
export function inclusiveRate(exclusive: Paise, gstRate: number): Paise {
  return mulDivRound(exclusive, 100 + gstRate, 100);
}

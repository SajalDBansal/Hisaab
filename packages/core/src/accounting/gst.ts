/**
 * GST figures for a month: summary, GSTR-1 (outward supplies) and GSTR-3B (summary return).
 * These are mock-friendly summaries for checking before filing, not the portal JSON format.
 *
 * Every bill line is sorted by its tax type (see taxType.ts):
 *   taxable → B2B / B2CL / B2CS and the tax tables
 *   nil, exempt, non-GST → GSTR-1 table 8, GSTR-3B 3.1(c) / 3.1(e) and table 5
 * Freight and other charges are always taxable.
 */
import { addDays, monthLabel, yearMonth } from "../dates";
import type {
  ISODate,
  Item,
  Paise,
  Party,
  TaxType,
  UnitDef,
  Voucher,
} from "../types";
import { uqcFor } from "../units";
import { isPosted } from "./bills";
import { voucherMode } from "./gstMode";
import { calcCharge, calcLine } from "./invoice";
import { baseQty } from "./stock";
import { lineTaxType, saleDocType } from "./taxType";

export interface TaxHeads {
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

/** Value of supplies that carry no GST, by kind. */
export interface NoTaxValues {
  nil: Paise;
  exempt: Paise;
  nonGst: Paise;
}

const zero = (): TaxHeads => ({ cgst: 0, sgst: 0, igst: 0 });
const total = (t: TaxHeads) => t.cgst + t.sgst + t.igst;
const noTax = (): NoTaxValues => ({ nil: 0, exempt: 0, nonGst: 0 });
const NO_TAX_KEY: Record<Exclude<TaxType, "taxable">, keyof NoTaxValues> = {
  nil: "nil",
  exempt: "exempt",
  nongst: "nonGst",
};

/** "2026-09" → due dates in the next month. */
export function gstDueDates(month: string) {
  const firstOfNext = addDays(`${month}-28`, 7).slice(0, 7);
  return {
    gstr1: `${firstOfNext}-11` as ISODate,
    gstr3b: `${firstOfNext}-20` as ISODate,
  };
}

/** "2026-09" → "Sep 2026" */
export function monthTitle(month: string): string {
  return `${monthLabel(month)} ${month.slice(0, 4)}`;
}

/** In the month's GST returns: posted, and saved while the firm was regular (composition and no-GST bills never count). */
const inMonth = (v: Voucher, month: string) =>
  isPosted(v) && voucherMode(v) === "regular" && yearMonth(v.date) === month;

/** GST rates that actually carry tax. */
type TaxedRate = 5 | 18 | 40;

/**
 * Split one bill into what GST applies to and what it doesn't.
 * `taxed` holds taxable lines + charges (with tax); `noTax` the value of nil, exempt and non-GST lines.
 */
export function billTaxSplit(v: Voucher) {
  const interState = !!v.interState;
  const taxed = { taxable: 0, ...zero() };
  const byRate = new Map<
    number,
    { rate: number; taxable: Paise; tax: Paise }
  >();
  const free = noTax();
  const addTaxed = (
    t: { taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise },
    rate: number,
  ) => {
    taxed.taxable += t.taxable;
    taxed.cgst += t.cgst;
    taxed.sgst += t.sgst;
    taxed.igst += t.igst;
    const r = byRate.get(rate) ?? { rate, taxable: 0, tax: 0 };
    r.taxable += t.taxable;
    r.tax += t.cgst + t.sgst + t.igst;
    byRate.set(rate, r);
  };
  for (const line of v.lines ?? []) {
    const type = lineTaxType(line);
    const t = calcLine(line, interState);
    if (type === "taxable") addTaxed(t, line.gstRate);
    else free[NO_TAX_KEY[type]] += t.taxable;
  }
  for (const c of v.charges ?? [])
    addTaxed(calcCharge(c, interState), c.gstRate);
  return {
    taxed,
    byRate: [...byRate.values()] as {
      rate: TaxedRate;
      taxable: Paise;
      tax: Paise;
    }[],
    noTax: free,
  };
}

// ---------------------------------------------------------------------------
// Set-off of input tax credit (simplified Rule 88A order)
// ---------------------------------------------------------------------------

/**
 * Uses input credit against output tax:
 *   IGST credit → IGST, then CGST, then SGST
 *   CGST credit → CGST, then IGST
 *   SGST credit → SGST, then IGST
 * Returns cash to pay per head and credit left over.
 */
export function setOff(
  output: TaxHeads,
  input: TaxHeads,
): { payable: TaxHeads; creditLeft: TaxHeads } {
  const due: TaxHeads = {
    cgst: output.cgst,
    sgst: output.sgst,
    igst: output.igst,
  };
  const credit: TaxHeads = {
    cgst: input.cgst,
    sgst: input.sgst,
    igst: input.igst,
  };
  const use = (from: keyof TaxHeads, to: keyof TaxHeads) => {
    // A return adjustment is not transferable credit or a negative payment.
    const x = Math.max(0, Math.min(credit[from], due[to]));
    credit[from] -= x;
    due[to] -= x;
  };
  use("igst", "igst");
  use("igst", "cgst");
  use("igst", "sgst");
  use("cgst", "cgst");
  use("cgst", "igst");
  use("sgst", "sgst");
  use("sgst", "igst");
  return { payable: due, creditLeft: credit };
}

// ---------------------------------------------------------------------------
// Month summary
// ---------------------------------------------------------------------------

export interface GstMonth {
  month: string;
  title: string;
  /** `taxable` is the value GST was charged on; nil/exempt/non-GST are kept separately. */
  output: TaxHeads & { taxable: Paise; total: Paise } & NoTaxValues;
  input: TaxHeads & { taxable: Paise; total: Paise } & NoTaxValues;
  /** Cash to pay after using input credit. */
  payable: TaxHeads & { total: Paise };
  /** Input credit carried to next month. */
  creditLeft: TaxHeads & { total: Paise };
  salesCount: number;
  purchaseCount: number;
  /** Sales that were bills of supply (no GST at all). */
  billsOfSupply: number;
  /** Sales returns and purchase returns made this month (already netted above). */
  creditNotes: number;
  debitNotes: number;
  dueDates: { gstr1: ISODate; gstr3b: ISODate };
}

export function gstMonth(vouchers: Voucher[], month: string): GstMonth {
  const output = { ...zero(), taxable: 0, ...noTax() };
  const input = { ...zero(), taxable: 0, ...noTax() };
  let salesCount = 0;
  let purchaseCount = 0;
  let billsOfSupply = 0;
  let creditNotes = 0;
  let debitNotes = 0;
  for (const v of vouchers) {
    if (!inMonth(v, month)) continue;
    // Returns reduce the tax of the month they are made in:
    // credit notes cut output tax, debit notes cut input credit.
    const isSaleSide = v.type === "sale" || v.type === "credit-note";
    const sign = v.type === "credit-note" || v.type === "debit-note" ? -1 : 1;
    if (!isSaleSide && v.type !== "purchase" && v.type !== "debit-note")
      continue;
    const { taxed, noTax: free } = billTaxSplit(v);
    const side = isSaleSide ? output : input;
    side.taxable += sign * taxed.taxable;
    side.cgst += sign * taxed.cgst;
    side.sgst += sign * taxed.sgst;
    side.igst += sign * taxed.igst;
    side.nil += sign * free.nil;
    side.exempt += sign * free.exempt;
    side.nonGst += sign * free.nonGst;
    if (v.type === "credit-note") creditNotes++;
    else if (v.type === "debit-note") debitNotes++;
    else if (v.type === "sale") {
      salesCount++;
      if ((v.docType ?? saleDocType(v.lines ?? [])) === "bill-of-supply")
        billsOfSupply++;
    } else purchaseCount++;
  }
  const { payable, creditLeft } = setOff(output, input);
  return {
    month,
    title: monthTitle(month),
    output: { ...output, total: total(output) },
    input: { ...input, total: total(input) },
    payable: { ...payable, total: total(payable) },
    creditLeft: { ...creditLeft, total: total(creditLeft) },
    salesCount,
    purchaseCount,
    billsOfSupply,
    creditNotes,
    debitNotes,
    dueDates: gstDueDates(month),
  };
}

// ---------------------------------------------------------------------------
// GSTR-1
// ---------------------------------------------------------------------------

/** Interstate sale to an unregistered buyer above this value goes in B2C Large. */
export const B2CL_LIMIT: Paise = 1_00_000_00;

/** Table 8 rows: who the supply went to and whether it crossed a state border. */
export type Table8Row =
  | "inter-registered"
  | "intra-registered"
  | "inter-unregistered"
  | "intra-unregistered";

export const TABLE8_LABELS: Record<Table8Row, string> = {
  "inter-registered": "Interstate · registered",
  "intra-registered": "Within state · registered",
  "inter-unregistered": "Interstate · unregistered",
  "intra-unregistered": "Within state · unregistered",
};

export interface Gstr1 {
  month: string;
  title: string;
  /** Registered buyers, one row per buyer. Only the GST-charged part of each bill. */
  b2b: {
    partyId: string;
    name: string;
    gstin: string;
    invoices: number;
    value: Paise;
    taxable: Paise;
    tax: Paise;
  }[];
  /** Large interstate invoices to unregistered buyers, one row per invoice. */
  b2cl: {
    voucherId: string;
    number: string;
    stateCode: string;
    value: Paise;
    taxable: Paise;
    tax: Paise;
  }[];
  /** Other taxable sales to unregistered buyers, grouped by place of supply and rate. */
  b2cs: { stateCode: string; rate: number; taxable: Paise; tax: Paise }[];
  /** Table 8: nil-rated, exempt and non-GST supplies. */
  noTax: ({ row: Table8Row; label: string } & NoTaxValues)[];
  /**
   * HSN summary (table 12) of GST goods (taxable, nil and exempt; non-GST goods are left out),
   * split like the return: B2B = buyers with a GSTIN, B2C = everyone else.
   */
  hsn: {
    kind: "b2b" | "b2c";
    hsn: string;
    description: string;
    uqc: string;
    qty: number;
    taxable: Paise;
    cgst: Paise;
    sgst: Paise;
    igst: Paise;
  }[];
  /** Table 9B: credit notes (sales returns), registered and unregistered buyers. */
  creditNotes: {
    voucherId: string;
    number: string;
    againstNumber: string;
    partyName: string;
    gstin?: string;
    taxable: Paise;
    tax: Paise;
  }[];
  /** Table 13, one row per series. */
  documents: {
    kind: "Tax invoices" | "Bills of supply" | "Credit notes";
    from: string;
    to: string;
    total: number;
    cancelled: number;
  }[];
  totals: { invoices: number; taxable: Paise; tax: Paise } & NoTaxValues;
}

/** Sales and returns share the same HSN grouping, including return-only months. */
function addHsn(
  rows: Map<string, Gstr1["hsn"][number]>,
  v: Voucher,
  items: Item[],
  units: UnitDef[] | undefined,
  kind: "b2b" | "b2c",
  sign: number,
) {
  const add = (
    code: string,
    description: string,
    uqc: string,
    qty: number,
    tax: TaxHeads & { taxable: number },
  ) => {
    const key = `${kind}|${code}|${uqc}`;
    const row = rows.get(key) ?? {
      kind,
      hsn: code,
      description,
      uqc,
      qty: 0,
      taxable: 0,
      ...zero(),
    };
    row.qty += sign * qty;
    row.taxable += sign * tax.taxable;
    row.cgst += sign * tax.cgst;
    row.sgst += sign * tax.sgst;
    row.igst += sign * tax.igst;
    rows.set(key, row);
  };
  for (const line of v.lines ?? []) {
    if (lineTaxType(line) === "nongst") continue;
    const item = (v.snapshot?.items ?? items).find(
      (item) => item.id === line.itemId,
    );
    add(
      item?.hsn ?? "",
      item?.name ?? "",
      uqcFor(item?.unit ?? "", v.snapshot?.units ?? units),
      baseQty(line),
      calcLine(line, !!v.interState),
    );
  }
  for (const charge of v.charges ?? [])
    add(
      "9965",
      "Freight and transport",
      "OTH",
      0,
      calcCharge(charge, !!v.interState),
    );
}

export function gstr1(
  vouchers: Voucher[],
  parties: Party[],
  items: Item[],
  month: string,
  /** Firm's units, for the GST unit codes in the HSN summary. */
  units?: UnitDef[],
): Gstr1 {
  const sales = vouchers.filter((v) => v.type === "sale" && inMonth(v, month));
  const b2b = new Map<string, Gstr1["b2b"][number]>();
  const b2cl: Gstr1["b2cl"] = [];
  const b2cs = new Map<string, Gstr1["b2cs"][number]>();
  const table8 = new Map<Table8Row, NoTaxValues>(
    (Object.keys(TABLE8_LABELS) as Table8Row[]).map((r) => [r, noTax()]),
  );
  const hsn = new Map<string, Gstr1["hsn"][number]>();
  const totals = { invoices: sales.length, taxable: 0, tax: 0, ...noTax() };

  for (const v of sales) {
    const party = v.snapshot
      ? v.snapshot.party
      : parties.find((p) => p.id === v.partyId);
    const { taxed, byRate, noTax: free } = billTaxSplit(v);
    const tax = total(taxed);
    totals.taxable += taxed.taxable;
    totals.tax += tax;
    totals.nil += free.nil;
    totals.exempt += free.exempt;
    totals.nonGst += free.nonGst;

    // Taxable part
    if (taxed.taxable > 0) {
      if (party?.gstin) {
        const key = `${party.id}|${party.gstin}`;
        const row = b2b.get(key) ?? {
          partyId: party.id,
          name: party.name,
          gstin: party.gstin,
          invoices: 0,
          value: 0,
          taxable: 0,
          tax: 0,
        };
        row.invoices++;
        row.value += v.amount;
        row.taxable += taxed.taxable;
        row.tax += tax;
        b2b.set(key, row);
      } else if (v.interState && v.amount > B2CL_LIMIT) {
        b2cl.push({
          voucherId: v.id,
          number: v.number,
          stateCode: party?.stateCode ?? "",
          value: v.amount,
          taxable: taxed.taxable,
          tax,
        });
      } else {
        for (const r of byRate) {
          const key = `${party?.stateCode ?? ""}-${r.rate}`;
          const row = b2cs.get(key) ?? {
            stateCode: party?.stateCode ?? "",
            rate: r.rate,
            taxable: 0,
            tax: 0,
          };
          row.taxable += r.taxable;
          row.tax += r.tax;
          b2cs.set(key, row);
        }
      }
    }

    // Table 8 part
    const t8 = table8.get(
      `${v.interState ? "inter" : "intra"}-${party?.gstin ? "registered" : "unregistered"}`,
    )!;
    t8.nil += free.nil;
    t8.exempt += free.exempt;
    t8.nonGst += free.nonGst;

    addHsn(hsn, v, items, units, party?.gstin ? "b2b" : "b2c", 1);
  }

  // Credit notes: listed in table 9B and taken off the HSN summary (it is net of returns)
  const creditNotes: Gstr1["creditNotes"] = [];
  for (const v of vouchers) {
    if (v.type !== "credit-note" || !inMonth(v, month)) continue;
    const party = v.snapshot
      ? v.snapshot.party
      : parties.find((p) => p.id === v.partyId);
    const { taxed } = billTaxSplit(v);
    creditNotes.push({
      voucherId: v.id,
      number: v.number,
      againstNumber: vouchers.find((x) => x.id === v.againstId)?.number ?? "",
      partyName: party?.name ?? "",
      gstin: party?.gstin,
      taxable: taxed.taxable,
      tax: total(taxed),
    });
    addHsn(hsn, v, items, units, party?.gstin ? "b2b" : "b2c", -1);
  }

  // Document summary per series; counts cancelled bills too (drafts have no final number yet)
  const issued = vouchers.filter(
    (v) =>
      v.type === "sale" &&
      v.status !== "draft" &&
      voucherMode(v) === "regular" &&
      yearMonth(v.date) === month,
  );
  const documents: Gstr1["documents"] = [];
  for (const [kind, docType] of [
    ["Tax invoices", "tax-invoice"],
    ["Bills of supply", "bill-of-supply"],
  ] as const) {
    const list = issued.filter(
      (v) => (v.docType ?? saleDocType(v.lines ?? [])) === docType,
    );
    if (!list.length) continue;
    const numbers = list.map((v) => v.number).sort();
    documents.push({
      kind,
      from: numbers[0],
      to: numbers[numbers.length - 1],
      total: list.length,
      cancelled: list.filter((v) => v.status === "cancelled").length,
    });
  }
  const notesIssued = vouchers
    .filter(
      (v) =>
        v.type === "credit-note" &&
        v.status !== "draft" &&
        voucherMode(v) === "regular" &&
        yearMonth(v.date) === month,
    )
    .sort((a, b) => a.number.localeCompare(b.number));
  if (notesIssued.length)
    documents.push({
      kind: "Credit notes",
      from: notesIssued[0].number,
      to: notesIssued[notesIssued.length - 1].number,
      total: notesIssued.length,
      cancelled: notesIssued.filter((v) => v.status === "cancelled").length,
    });

  return {
    month,
    title: monthTitle(month),
    b2b: [...b2b.values()].sort((a, b) => b.taxable - a.taxable),
    b2cl,
    b2cs: [...b2cs.values()].sort((a, b) => a.rate - b.rate),
    noTax: [...table8.entries()].map(([row, values]) => ({
      row,
      label: TABLE8_LABELS[row],
      ...values,
    })),
    hsn: [...hsn.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.hsn.localeCompare(b.hsn),
    ),
    creditNotes,
    documents,
    totals,
  };
}

// ---------------------------------------------------------------------------
// GSTR-3B
// ---------------------------------------------------------------------------

export interface Gstr3b {
  month: string;
  title: string;
  /** 3.1(a) Outward taxable supplies (other than nil rated and exempt). */
  outwardTaxable: TaxHeads & { taxable: Paise };
  /** 3.1(c) Nil rated and exempted supplies. */
  outwardNil: Paise;
  /** 3.1(e) Non-GST outward supplies. */
  outwardNonGst: Paise;
  /** 4(A)(5) All other ITC. */
  itc: TaxHeads;
  /** 5. Inward supplies that carry no GST, split by interstate / within state. */
  inwardNoTax: {
    nilExempt: { inter: Paise; intra: Paise };
    nonGst: { inter: Paise; intra: Paise };
  };
  /** 6.1 Tax paid in cash after using credit. */
  payable: TaxHeads & { total: Paise };
  creditLeft: TaxHeads & { total: Paise };
}

export function gstr3b(vouchers: Voucher[], month: string): Gstr3b {
  const summary = gstMonth(vouchers, month);
  const inward = {
    nilExempt: { inter: 0, intra: 0 },
    nonGst: { inter: 0, intra: 0 },
  };
  for (const v of vouchers) {
    if (v.type !== "purchase" || !inMonth(v, month)) continue;
    const { noTax: free } = billTaxSplit(v);
    const where = v.interState ? "inter" : "intra";
    inward.nilExempt[where] += free.nil + free.exempt;
    inward.nonGst[where] += free.nonGst;
  }
  const { cgst, sgst, igst, taxable, nil, exempt, nonGst } = summary.output;
  return {
    month,
    title: summary.title,
    outwardTaxable: { taxable, cgst, sgst, igst },
    outwardNil: nil + exempt,
    outwardNonGst: nonGst,
    itc: {
      cgst: summary.input.cgst,
      sgst: summary.input.sgst,
      igst: summary.input.igst,
    },
    inwardNoTax: inward,
    payable: summary.payable,
    creditLeft: summary.creditLeft,
  };
}

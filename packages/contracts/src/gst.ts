import { z } from "zod";
import { Id, IsoDate, Paise } from "./common";

export const MonthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM."),
});

export const CountQuery = z.object({
  count: z.coerce.number().int().min(1).max(24).default(4),
});

const TaxHeads = z.object({ cgst: Paise, sgst: Paise, igst: Paise });
const NoTaxValues = z.object({ nil: Paise, exempt: Paise, nonGst: Paise });
const TaxTotal = TaxHeads.extend({ total: Paise });
// Answers cached offline before credit carry-forward existed read as zero.
const NoCarry = TaxTotal.default({ cgst: 0, sgst: 0, igst: 0, total: 0 });
const TaxableTotal = TaxTotal.extend({ taxable: Paise }).merge(NoTaxValues);

export const GstMonth = z.object({
  month: z.string(),
  title: z.string(),
  output: TaxableTotal,
  input: TaxableTotal,
  broughtForward: NoCarry,
  payable: TaxTotal,
  creditLeft: TaxTotal,
  salesCount: z.number().int(),
  purchaseCount: z.number().int(),
  billsOfSupply: z.number().int(),
  creditNotes: z.number().int(),
  debitNotes: z.number().int(),
  dueDates: z.object({ gstr1: IsoDate, gstr3b: IsoDate }),
});

export const Gstr1 = z.object({
  month: z.string(),
  title: z.string(),
  b2b: z.array(
    z.object({
      partyId: Id,
      name: z.string(),
      gstin: z.string(),
      invoices: z.number().int(),
      value: Paise,
      taxable: Paise,
      tax: Paise,
    }),
  ),
  b2cl: z.array(
    z.object({
      voucherId: Id,
      number: z.string(),
      stateCode: z.string(),
      value: Paise,
      taxable: Paise,
      tax: Paise,
    }),
  ),
  b2cs: z.array(
    z.object({
      stateCode: z.string(),
      rate: z.number(),
      taxable: Paise,
      tax: Paise,
    }),
  ),
  noTax: z.array(
    z
      .object({
        row: z.enum([
          "inter-registered",
          "intra-registered",
          "inter-unregistered",
          "intra-unregistered",
        ]),
        label: z.string(),
      })
      .merge(NoTaxValues),
  ),
  hsn: z.array(
    z.object({
      kind: z.enum(["b2b", "b2c"]),
      hsn: z.string(),
      description: z.string(),
      uqc: z.string(),
      qty: z.number(),
      taxable: Paise,
      cgst: Paise,
      sgst: Paise,
      igst: Paise,
    }),
  ),
  creditNotes: z.array(
    z.object({
      voucherId: Id,
      number: z.string(),
      againstNumber: z.string(),
      partyName: z.string(),
      gstin: z.string().optional(),
      taxable: Paise,
      tax: Paise,
    }),
  ),
  documents: z.array(
    z.object({
      kind: z.enum(["Tax invoices", "Bills of supply", "Credit notes"]),
      from: z.string(),
      to: z.string(),
      total: z.number().int(),
      cancelled: z.number().int(),
    }),
  ),
  totals: z
    .object({ invoices: z.number().int(), taxable: Paise, tax: Paise })
    .merge(NoTaxValues),
});

export const Gstr3b = z.object({
  month: z.string(),
  title: z.string(),
  outwardTaxable: TaxHeads.extend({ taxable: Paise }),
  outwardNil: Paise,
  outwardNonGst: Paise,
  itc: TaxHeads,
  inwardNoTax: z.object({
    nilExempt: z.object({ inter: Paise, intra: Paise }),
    nonGst: z.object({ inter: Paise, intra: Paise }),
  }),
  broughtForward: NoCarry,
  payable: TaxTotal,
  creditLeft: TaxTotal,
});

export const CompositionQuarter = z.object({
  months: z.array(z.string()),
  label: z.string(),
  turnover: Paise,
  sales: Paise,
  returns: Paise,
  rate: z.number(),
  tax: Paise,
  due: IsoDate,
});

export type GstMonth = z.infer<typeof GstMonth>;
export type Gstr1 = z.infer<typeof Gstr1>;
export type Gstr3b = z.infer<typeof Gstr3b>;
export type CompositionQuarter = z.infer<typeof CompositionQuarter>;

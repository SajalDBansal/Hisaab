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

// ---- GSTR-1 upload file (doc 37, T31) ----------------------------------------
// Key order follows the GST offline tool; amounts are rupees with 2 decimals.
const Rupees = z.number().finite();
const ItemDetail = z.object({
  rt: z.number(),
  txval: Rupees,
  iamt: Rupees.optional(),
  camt: Rupees.optional(),
  samt: Rupees.optional(),
  csamt: Rupees,
});
const PortalItem = z.object({ num: z.number().int(), itm_det: ItemDetail });
const DocNumber = z.string().min(1);
const PortalDate = z.string().regex(/^\d{2}-\d{2}-\d{4}$/);
const StateCode = z.string();
const HsnRow = z.object({
  num: z.number().int(),
  hsn_sc: z.string(),
  desc: z.string(),
  uqc: z.string(),
  qty: z.number(),
  rt: z.number(),
  txval: Rupees,
  iamt: Rupees,
  camt: Rupees,
  samt: Rupees,
  csamt: Rupees,
});

export const Gstr1PortalJson = z.object({
  gstin: z.string(),
  fp: z.string().regex(/^\d{6}$/),
  version: z.string(),
  hash: z.literal("hash"),
  b2b: z
    .array(
      z.object({
        ctin: z.string(),
        inv: z.array(
          z.object({
            inum: DocNumber,
            idt: PortalDate,
            val: Rupees,
            pos: StateCode,
            rchrg: z.literal("N"),
            inv_typ: z.literal("R"),
            itms: z.array(PortalItem),
          }),
        ),
      }),
    )
    .optional(),
  b2cl: z
    .array(
      z.object({
        pos: StateCode,
        inv: z.array(
          z.object({
            inum: DocNumber,
            idt: PortalDate,
            val: Rupees,
            itms: z.array(PortalItem),
          }),
        ),
      }),
    )
    .optional(),
  b2cs: z
    .array(
      z.object({
        sply_ty: z.enum(["INTER", "INTRA"]),
        pos: StateCode,
        typ: z.literal("OE"),
        rt: z.number(),
        txval: Rupees,
        iamt: Rupees.optional(),
        camt: Rupees.optional(),
        samt: Rupees.optional(),
        csamt: Rupees,
      }),
    )
    .optional(),
  cdnr: z
    .array(
      z.object({
        ctin: z.string(),
        nt: z.array(
          z.object({
            ntty: z.literal("C"),
            nt_num: DocNumber,
            nt_dt: PortalDate,
            val: Rupees,
            pos: StateCode,
            rchrg: z.literal("N"),
            inv_typ: z.literal("R"),
            itms: z.array(PortalItem),
          }),
        ),
      }),
    )
    .optional(),
  cdnur: z
    .array(
      z.object({
        typ: z.literal("B2CL"),
        ntty: z.literal("C"),
        nt_num: DocNumber,
        nt_dt: PortalDate,
        val: Rupees,
        pos: StateCode,
        itms: z.array(PortalItem),
      }),
    )
    .optional(),
  nil: z
    .object({
      inv: z.array(
        z.object({
          sply_ty: z.enum(["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"]),
          nil_amt: Rupees,
          expt_amt: Rupees,
          ngsup_amt: Rupees,
        }),
      ),
    })
    .optional(),
  hsn: z
    .object({ hsn_b2b: z.array(HsnRow), hsn_b2c: z.array(HsnRow) })
    .optional(),
  doc_issue: z
    .object({
      doc_det: z.array(
        z.object({
          doc_num: z.number().int(),
          docs: z.array(
            z.object({
              num: z.number().int(),
              from: z.string(),
              to: z.string(),
              totnum: z.number().int(),
              cancel: z.number().int(),
              net_issue: z.number().int(),
            }),
          ),
        }),
      ),
    })
    .optional(),
});

/** The file plus what to fix before uploading it. */
export const Gstr1Export = z.object({
  month: z.string(),
  fileName: z.string(),
  warnings: z.array(z.string()),
  json: Gstr1PortalJson,
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
  // Older cached answers predate the books entry.
  recorded: Paise.default(0),
  end: IsoDate.optional(),
  due: IsoDate,
});

export type GstMonth = z.infer<typeof GstMonth>;
export type Gstr1 = z.infer<typeof Gstr1>;
export type Gstr3b = z.infer<typeof Gstr3b>;
export type Gstr1Export = z.infer<typeof Gstr1Export>;
export type CompositionQuarter = z.infer<typeof CompositionQuarter>;

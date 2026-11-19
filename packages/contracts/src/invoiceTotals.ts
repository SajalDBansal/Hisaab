import { z } from "zod";
import { GstRate, Paise } from "./common";

const TaxHeads = z.object({
  taxable: Paise,
  cgst: Paise,
  sgst: Paise,
  igst: Paise,
});
const LineTotals = TaxHeads.extend({
  gross: Paise,
  discount: Paise,
  billDiscount: Paise.default(0),
  tax: Paise,
  total: Paise,
});

export const InvoiceTotals = TaxHeads.extend({
  lines: z.array(LineTotals),
  charges: z.array(LineTotals),
  itemsTaxable: Paise,
  billDiscount: Paise.default(0),
  tax: Paise,
  totalBeforeRound: Paise,
  roundOff: Paise,
  grandTotal: Paise,
  byRate: z.array(TaxHeads.extend({ rate: GstRate })),
});

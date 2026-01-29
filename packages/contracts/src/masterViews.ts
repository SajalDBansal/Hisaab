import { z } from "zod";
import { IsoDate, Paise } from "./common";
import { PartyRow } from "./parties";
import { ItemRow } from "./items";
import { Ledger } from "./ledgers";
import { Ageing, ReportVoucher } from "./reports";

export const PartyListRow = PartyRow.extend({
  overdueAmount: Paise,
  maxOverdueDays: z.number().int(),
});

export const Bill = z.object({
  id: z.string(),
  number: z.string(),
  date: IsoDate,
  dueDate: IsoDate,
  amount: Paise,
  settled: Paise,
  pending: Paise,
  ageDays: z.number().int(),
  overdueDays: z.number().int(),
});

// Keep the flat master fields for existing API clients, and add the screen's read model.
export const PartyDetail = PartyListRow.extend({
  unallocated: Paise,
  party: PartyRow,
  bills: z.array(Bill),
  openBills: z.array(Bill),
  ageing: Ageing,
  overLimitBy: Paise,
  transactions: z.array(ReportVoucher),
});

export const ItemDetail = ItemRow.safeExtend({
  item: ItemRow,
  qty: z.number(),
  value: Paise,
  movements: z.array(
    z.object({
      voucherId: z.string(),
      number: z.string(),
      date: IsoDate,
      type: z.enum([
        "sale",
        "purchase",
        "credit-note",
        "debit-note",
        "delivery-note",
        "journal",
      ]),
      qty: z.number(),
      entered: z.string().optional(),
    }),
  ),
  profit: z.object({
    soldQty: z.number(),
    salesValue: Paise,
    cost: Paise,
    profit: Paise,
  }),
});

export const LedgerStatement = z.object({
  ledger: Ledger,
  opening: Paise,
  totalIn: Paise,
  totalOut: Paise,
  closing: Paise,
  rows: z.array(
    z.object({
      voucher: ReportVoucher,
      particulars: z.string(),
      moneyIn: Paise,
      moneyOut: Paise,
      balance: Paise,
    }),
  ),
});

import { z } from "zod";
import { Id, IsoDate, Paise } from "./common";
import { Ledger } from "./ledgers";
import { Party, PartyType } from "./parties";
import { Voucher } from "./vouchers";
import { CompositionQuarter } from "./gst";

export const PeriodKey = z.enum(["this-month", "last-month", "quarter", "fy"]);
export const TaxScope = z.enum(["all", "gst", "nongst"]);
export const ReportTradeKind = z.enum(["sale", "purchase"]);

export const ReportPeriodQuery = z.object({
  tax: TaxScope.default("all"),
  period: PeriodKey.default("this-month"),
});

export const AsOfQuery = z.object({
  tax: TaxScope.default("all"),
  from: IsoDate.optional(),
  asOf: IsoDate.optional(),
});

export const TradeSummaryQuery = ReportPeriodQuery.extend({
  tax: TaxScope.default("all"),
});

export const OutstandingQuery = z.object({
  type: PartyType,
  tax: TaxScope.default("all"),
});
export const StockSummaryQuery = z.object({ tax: TaxScope.default("all") });

/** A statement, optionally a page of its rows at a time (`limit`, `cursor`). */
export const StatementQuery = StockSummaryQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
});
/** Present when a page was asked for. */
export const StatementPaging = {
  rowsTotal: z.number().int().optional(),
  nextCursor: z.string().nullable().optional(),
};

export const ReportVoucher = Voucher.omit({ version: true }).extend({
  version: z.number().int().optional(),
});
export const ReconciliationView = z.object({
  ledger: Ledger,
  asOf: IsoDate,
  booksBalance: Paise,
  unclearedIn: Paise,
  unclearedOut: Paise,
  bankBalance: Paise,
  entries: z.array(
    z.object({
      voucher: ReportVoucher,
      amount: Paise,
      clearedOn: IsoDate.optional(),
    }),
  ),
});

export const Ageing = z.object({
  "0-30": Paise,
  "31-60": Paise,
  "61-90": Paise,
  "90+": Paise,
});

export const DashboardData = z.object({
  toCollect: Paise,
  customersWithBalance: z.number().int(),
  overdueCustomers: z.number().int(),
  toPay: Paise,
  suppliersWithBalance: z.number().int(),
  cash: Paise,
  banks: z.array(z.object({ ledger: Ledger, balance: Paise })),
  bankTotal: Paise,
  todaySales: z.object({ amount: Paise, count: z.number().int() }),
  monthSales: Paise,
  lastMonthSales: Paise,
  gst: z
    .object({
      month: z.string(),
      output: Paise,
      input: Paise,
      payable: Paise,
    })
    .nullable(),
  composition: CompositionQuarter.nullable(),
  monthPurchases: Paise,
  lowStockCount: z.number().int(),
  stockValue: Paise,
  salesVsPurchases: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      sales: Paise,
      purchases: Paise,
    }),
  ),
  cashTrend: z.array(
    z.object({ month: z.string(), label: z.string(), balance: Paise }),
  ),
  topOverdue: z.array(
    z.object({
      party: Party,
      balance: Paise,
      overdueAmount: Paise,
      maxOverdueDays: z.number().int(),
    }),
  ),
  recent: z.array(ReportVoucher),
  upcoming: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      date: IsoDate,
      daysLeft: z.number().int(),
      amount: Paise.optional(),
    }),
  ),
});

export const Outstanding = z.object({
  type: PartyType,
  total: Paise,
  overdue: Paise,
  ageing: Ageing,
  onAccount: Paise,
  rows: z.array(
    z.object({
      partyId: Id,
      name: z.string(),
      city: z.string(),
      amount: Paise,
      ageing: Ageing,
      overdue: Paise,
      maxOverdueDays: z.number().int(),
      onAccount: Paise,
    }),
  ),
});

export const TradeSummary = z.object({
  count: z.number().int(),
  taxable: Paise,
  tax: Paise,
  total: Paise,
  returns: z.object({ count: z.number().int(), total: Paise }),
  byMonth: z.array(
    z.object({ month: z.string(), label: z.string(), total: Paise }),
  ),
  byParty: z.array(
    z.object({
      partyId: z.string(),
      name: z.string(),
      count: z.number().int(),
      total: Paise,
    }),
  ),
  byItem: z.array(
    z.object({
      itemId: Id,
      name: z.string(),
      qty: z.number(),
      unit: z.string(),
      qtyLabel: z.string(),
      taxable: Paise,
    }),
  ),
});

export const ExpenseSummary = z.object({
  total: Paise,
  heads: z.array(
    z.object({
      head: z.string(),
      entries: z.number().int(),
      total: Paise,
    }),
  ),
});

export const StockSummary = z.object({
  totalValue: Paise,
  itemCount: z.number().int(),
  lowCount: z.number().int(),
  groups: z.array(
    z.object({
      group: z.string(),
      value: Paise,
      items: z.array(
        z.object({
          itemId: Id,
          name: z.string(),
          qty: z.number(),
          unit: z.string(),
          qtyLabel: z.string(),
          value: Paise,
          low: z.boolean(),
        }),
      ),
    }),
  ),
});

export type PeriodKey = z.infer<typeof PeriodKey>;
export type TaxScope = z.infer<typeof TaxScope>;
export type DashboardData = z.infer<typeof DashboardData>;
export type Outstanding = z.infer<typeof Outstanding>;
export type TradeSummary = z.infer<typeof TradeSummary>;
export type ExpenseSummary = z.infer<typeof ExpenseSummary>;
export type StockSummary = z.infer<typeof StockSummary>;

import { z } from "zod";
import { daysBetween } from "@repo/core";
import { IsoDate, NonNegativePaise, Paise, PositivePaise } from "./common";
import { TaxScope } from "./reports";

export const ExpectedCashFlow = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1, "Describe the expected flow.").max(120),
    date: IsoDate,
    direction: z.enum(["in", "out"]),
    amount: PositivePaise,
    bookScope: z.enum(["gst", "nongst"]),
  })
  .strict();

export const CashForecastRequest = z
  .object({
    asOf: IsoDate,
    to: IsoDate,
    tax: TaxScope.default("all"),
    includeOverdue: z.boolean().default(false),
    manualFlows: z.array(ExpectedCashFlow).max(100).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.asOf < "0100-01-01" ||
      value.to <= value.asOf ||
      daysBetween(value.asOf, value.to) > 366
    )
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Forecast 1 to 366 days after the as-of date.",
      });
    const ids = new Set<string>();
    value.manualFlows.forEach((flow, index) => {
      if (flow.date <= value.asOf || flow.date > value.to)
        ctx.addIssue({
          code: "custom",
          path: ["manualFlows", index, "date"],
          message: "Choose a date within the forecast.",
        });
      if (ids.has(flow.id))
        ctx.addIssue({
          code: "custom",
          path: ["manualFlows", index, "id"],
          message: "Expected flow ids must be unique.",
        });
      ids.add(flow.id);
    });
  });

export const CashForecastTotals = z.object({
  opening: Paise,
  billInflows: NonNegativePaise,
  billOutflows: NonNegativePaise,
  manualInflows: NonNegativePaise,
  manualOutflows: NonNegativePaise,
  inflows: NonNegativePaise,
  outflows: NonNegativePaise,
  net: Paise,
  closing: Paise,
});

export const CashForecast = z.object({
  asOf: IsoDate,
  from: IsoDate,
  to: IsoDate,
  tax: TaxScope,
  includeOverdue: z.boolean(),
  opening: z.object({
    cash: Paise,
    bank: Paise,
    total: Paise,
    ledgers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["cash", "bank"]),
        balance: Paise,
      }),
    ),
  }),
  totals: CashForecastTotals,
  days: z
    .array(CashForecastTotals.extend({ date: IsoDate }))
    .min(1)
    .max(366),
  minimumBalance: Paise,
  firstShortfallDate: IsoDate.nullable(),
  bills: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      partyId: z.string(),
      partyName: z.string(),
      bookScope: z.enum(["gst", "nongst"]),
      dueDate: IsoDate,
      expectedDate: IsoDate,
      direction: z.enum(["in", "out"]),
      amount: PositivePaise,
      overdue: z.boolean(),
    }),
  ),
  manualFlows: z.array(ExpectedCashFlow),
  excluded: z.object({
    overdueInflows: NonNegativePaise,
    overdueOutflows: NonNegativePaise,
    laterInflows: NonNegativePaise,
    laterOutflows: NonNegativePaise,
  }),
  reconciliation: z
    .array(CashForecastTotals.extend({ tax: TaxScope }))
    .length(3),
  assumptions: z.array(z.string()),
});

export type ExpectedCashFlow = z.infer<typeof ExpectedCashFlow>;
export type CashForecastRequest = z.infer<typeof CashForecastRequest>;
export type CashForecast = z.infer<typeof CashForecast>;

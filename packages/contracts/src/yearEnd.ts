import { z } from "zod";
import { IsoDate, Paise } from "./common";
import { FinalAccounts, TrialBalance } from "./accounts";

export const YearEndQuery = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
});
export const YearEndView = z.object({
  year: z.number().int(),
  from: IsoDate,
  to: IsoDate,
  nextFrom: IsoDate,
  version: z.number().int(),
  digest: z.string().length(64),
  canClose: z.boolean(),
  blockers: z.array(z.string()),
  scopes: z.array(
    z.object({
      tax: z.enum(["all", "gst", "nongst"]),
      trialBalance: TrialBalance,
      finalAccounts: FinalAccounts,
      receivable: Paise,
      payable: Paise,
      negativeLots: z.number().int().nonnegative(),
    }),
  ),
});
export const YearEndClose = z.object({
  year: z.number().int().min(1900).max(2100),
  version: z.number().int().nonnegative(),
  digest: z.string().length(64),
  reason: z.string().trim().min(10).max(500),
});
export type YearEndView = z.infer<typeof YearEndView>;
export type YearEndClose = z.infer<typeof YearEndClose>;

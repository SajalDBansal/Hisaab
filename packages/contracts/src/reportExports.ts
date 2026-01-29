import { REPORT_IDS, REPORTS } from "@repo/core";
import { z } from "zod";
import { Id, IsoDate, IsoDateTime } from "./common";

export const ReportRequest = z
  .object({
    tax: z.enum(["all", "gst", "nongst"]).optional(),
    report: z.enum(REPORT_IDS),
    from: IsoDate,
    to: IsoDate,
    accountKey: z.string().min(1).max(250).optional(),
    partyId: Id.optional(),
    includeNarration: z.boolean().default(true),
    includeZeroBalances: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.from > value.to)
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "End date must be on or after start date.",
      });
    if (value.accountKey && !REPORTS[value.report].accounts)
      ctx.addIssue({
        code: "custom",
        path: ["accountKey"],
        message: "This report has no account filter.",
      });
    if (value.partyId && !REPORTS[value.report].parties)
      ctx.addIssue({
        code: "custom",
        path: ["partyId"],
        message: "This report has no party filter.",
      });
  });

export const ReportDocument = z.object({
  title: z.string(),
  firmName: z.string(),
  address: z.string(),
  gstin: z.string(),
  period: z.string(),
  generatedAt: IsoDateTime,
  fileName: z.string(),
  notes: z.array(z.string()),
  sections: z.array(
    z.object({
      title: z.string(),
      columns: z.array(
        z.object({
          label: z.string(),
          kind: z.enum(["text", "money", "number"]),
        }),
      ),
      rows: z.array(
        z.object({
          cells: z.array(z.union([z.string(), z.number()])),
          total: z.boolean().optional(),
        }),
      ),
    }),
  ),
});
export type ReportRequest = z.infer<typeof ReportRequest>;
export type ReportDocument = z.infer<typeof ReportDocument>;

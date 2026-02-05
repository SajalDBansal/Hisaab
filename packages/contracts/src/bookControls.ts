import { z } from "zod";
import { Id, IsoDate, IsoDateTime, Paise, pageOf } from "./common";

export const BookControlEvent = z.object({
  id: Id,
  action: z.string(),
  reason: z.string(),
  userName: z.string(),
  at: IsoDateTime,
});
export const BookControlHistoryQuery = z.object({
  cursor: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const BookControlHistoryPage = pageOf(BookControlEvent);
export type BookControlHistoryPage = z.infer<typeof BookControlHistoryPage>;

export const BookControlChange = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("approve-openings"),
      digest: z.string().length(64),
      capital: Paise,
    }),
    z.object({ action: z.literal("close-period"), date: IsoDate }),
    z.object({ action: z.literal("reopen-period"), date: IsoDate.nullable() }),
    z.object({ action: z.literal("reopen-openings") }),
  ])
  .and(
    z.object({
      version: z.number().int().nonnegative(),
      reason: z.string().trim().min(10).max(500),
    }),
  );

export const BookControlView = z.object({
  version: z.number().int(),
  canManage: z.boolean(),
  closedThrough: IsoDate.nullable(),
  openingApprovedAt: IsoDateTime.nullable(),
  openingApprovedBy: z.string().nullable(),
  opening: z.object({
    digest: z.string(),
    capital: Paise,
    rows: z.array(
      z.object({
        account: z.string(),
        ledger: z.string(),
        debit: Paise,
        credit: Paise,
      }),
    ),
  }),
  history: z.array(BookControlEvent),
});

export type BookControlChange = z.infer<typeof BookControlChange>;
export type BookControlView = z.infer<typeof BookControlView>;

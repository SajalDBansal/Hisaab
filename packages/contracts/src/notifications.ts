import { z } from "zod";
import { Id, IsoDate } from "./common";

export const NoticeKind = z.enum([
  "overdue",
  "payable",
  "reminders",
  "low-stock",
  "estimate",
  "gst",
  "backup",
]);

export const NoticeLink = z.object({
  screen: z.enum([
    "party",
    "item",
    "voucher",
    "reminders",
    "gst",
    "backup",
    "outstanding",
  ]),
  id: Id.optional(),
});

export const Notice = z.object({
  id: z.string(),
  kind: NoticeKind,
  title: z.string(),
  body: z.string(),
  date: IsoDate,
  tone: z.enum(["give", "warn", "ink"]),
  link: NoticeLink,
});

export const NoticeRow = Notice.extend({
  read: z.boolean(),
});

export const NoticeList = z.object({
  notices: z.array(NoticeRow),
  unread: z.number().int().min(0),
});

export const NotificationReadInput = z.object({
  ids: z.array(z.string().min(1)).max(100),
});

export type NoticeRow = z.infer<typeof NoticeRow>;
export type NoticeList = z.infer<typeof NoticeList>;

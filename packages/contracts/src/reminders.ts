import { z } from "zod";
import { Id, IsoDate, NonNegativePaise, PositivePaise } from "./common";

export const PaymentReminder = z.object({
  text: z.string(),
  phone: z.string().optional(),
  balance: PositivePaise,
});

export const ReminderDue = z.object({
  partyId: Id,
  partyName: z.string(),
  phone: z.string(),
  pending: PositivePaise,
  overdueDays: z.number().int().nonnegative(),
  reason: z.enum(["before-due", "due-today", "overdue"]),
  bill: z.object({
    number: z.string(),
    dueDate: IsoDate,
    pending: NonNegativePaise,
  }),
  lastSent: IsoDate.optional(),
});

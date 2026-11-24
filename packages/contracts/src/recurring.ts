import { z } from "zod";
import { Id, IsoDate, IsoDateTime, Paise, requiredText } from "./common";
import {
  NewContraInput,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewMoneyInput,
  Voucher,
} from "./vouchers";

/** Recurring entries and approvals (doc 37, T03 and T06). */
export const RecurringType = z.enum([
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "contra",
]);
export const ApprovalType = z.enum([
  "receipt",
  "payment",
  "contra",
  "expense",
  "journal",
]);
export const RecurringFrequency = z.enum([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

/** The same input each voucher type's own create takes. */
export const ENTRY_INPUTS = {
  sale: NewInvoiceInput,
  purchase: NewInvoiceInput,
  receipt: NewMoneyInput,
  payment: NewMoneyInput,
  expense: NewExpenseInput,
  journal: NewJournalInput,
  contra: NewContraInput,
} as const;

/** An entry's input as sent; checked against its type's own schema by the server. */
export const EntryPayload = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 200_000, {
    message: "The entry is too large.",
  });

const Plan = {
  name: requiredText("Name the schedule, like Shop rent.", 80),
  frequency: RecurringFrequency,
  interval: z.number().int().min(1).max(99).default(1),
  startDate: IsoDate,
  endDate: IsoDate.nullable().optional(),
  maxCount: z.number().int().min(1).max(1000).nullable().optional(),
  active: z.boolean().default(true),
};

export const RecurringScheduleInput = z.strictObject({
  ...Plan,
  voucherType: RecurringType,
  /** The entry without its date (a date sent here is ignored). */
  template: EntryPayload,
});

/** Make a schedule from a saved entry: its party, items or accounts repeat. */
export const RecurringFromVoucherInput = z.strictObject(Plan);

export const RecurringScheduleUpdate = z.strictObject({
  ...Plan,
  template: EntryPayload.optional(),
  /** Move the next date (it must not be before the first one). */
  nextDate: IsoDate.nullable().optional(),
});

export const RecurringSchedule = z.object({
  id: Id,
  name: z.string(),
  voucherType: RecurringType,
  template: z.record(z.string(), z.unknown()),
  frequency: RecurringFrequency,
  interval: z.number().int(),
  startDate: IsoDate,
  endDate: IsoDate.nullable(),
  maxCount: z.number().int().nullable(),
  /** Entries made (or skipped) so far. */
  generatedCount: z.number().int(),
  /** Null when the schedule has ended. */
  nextDate: IsoDate.nullable(),
  active: z.boolean(),
  /** The last date skipped because the books were closed. */
  lastSkippedOn: IsoDate.nullable(),
  partyName: z.string().optional(),
  amount: Paise.optional(),
  sourceVoucherId: Id.nullable(),
  createdByName: z.string(),
  createdAt: IsoDateTime,
  version: z.number().int(),
});

export const PendingEntryStatus = z.enum([
  "draft",
  "submitted",
  "rejected",
  "posted",
  "discarded",
]);

export const PendingEntryEvent = z.object({
  action: z.enum([
    "made",
    "edited",
    "submitted",
    "approved",
    "rejected",
    "posted",
    "discarded",
  ]),
  at: IsoDateTime,
  userName: z.string(),
  note: z.string().optional(),
});

/** An entry that is not (yet) in the books: a recurring draft or one waiting for approval. */
export const PendingEntry = z.object({
  id: Id,
  voucherType: RecurringType,
  status: PendingEntryStatus,
  source: z.enum(["recurring", "approval"]),
  date: IsoDate,
  partyId: Id.nullable(),
  partyName: z.string().optional(),
  /** About this much (the server works out the exact total when it posts). */
  amount: Paise,
  input: z.record(z.string(), z.unknown()),
  scheduleId: Id.nullable(),
  scheduleName: z.string().optional(),
  note: z.string().nullable(),
  createdByName: z.string(),
  submittedById: Id.nullable(),
  submittedByName: z.string().nullable(),
  submittedAt: IsoDateTime.nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: IsoDateTime.nullable(),
  rejectReason: z.string().nullable(),
  voucherId: Id.nullable(),
  history: z.array(PendingEntryEvent),
  createdAt: IsoDateTime,
  version: z.number().int(),
});

export const PendingEntryList = z.object({
  entries: z.array(PendingEntry),
  counts: z.object({
    drafts: z.number().int(),
    submitted: z.number().int(),
    rejected: z.number().int(),
  }),
  /** May this person approve entries? */
  canApprove: z.boolean(),
});

/** Send a new entry for approval (instead of posting it). */
export const SubmitEntryInput = z.strictObject({
  voucherType: ApprovalType,
  input: EntryPayload,
});

/** Save (post, or send for approval) or approve, optionally with edits. */
export const EntryActionInput = z.strictObject({
  input: EntryPayload.optional(),
});

export const RejectEntryInput = z.strictObject({
  reason: requiredText("Say why you're sending it back.", 200),
});

export const EntryActionResult = z.object({
  entry: PendingEntry,
  /** The posted voucher, when the action posted it. */
  voucher: Voucher.optional(),
});

export const ApprovalSettings = z.strictObject({
  types: z.array(ApprovalType).max(5),
});
export const ApprovalSettingsView = ApprovalSettings.extend({
  version: z.number().int(),
  /** May the caller approve (and post these types directly)? */
  canApprove: z.boolean(),
});

export type RecurringType = z.infer<typeof RecurringType>;
export type ApprovalType = z.infer<typeof ApprovalType>;
export type RecurringScheduleInput = z.infer<typeof RecurringScheduleInput>;
export type RecurringFromVoucherInput = z.infer<
  typeof RecurringFromVoucherInput
>;
export type RecurringScheduleUpdate = z.infer<typeof RecurringScheduleUpdate>;
export type RecurringSchedule = z.infer<typeof RecurringSchedule>;
export type PendingEntry = z.infer<typeof PendingEntry>;
export type PendingEntryList = z.infer<typeof PendingEntryList>;
export type SubmitEntryInput = z.infer<typeof SubmitEntryInput>;
export type EntryActionInput = z.infer<typeof EntryActionInput>;
export type EntryActionResult = z.infer<typeof EntryActionResult>;
export type ApprovalSettings = z.infer<typeof ApprovalSettings>;
export type ApprovalSettingsView = z.infer<typeof ApprovalSettingsView>;

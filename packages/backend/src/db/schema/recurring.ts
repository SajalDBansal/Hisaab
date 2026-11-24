import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment, paise, primaryId, stamps } from "./columns";
import { voucherType } from "./vouchers";

// Recurring entries and approvals (doc 37, T03 and T06).

export const recurringFrequency = pgEnum("recurring_frequency", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

/**
 * A voucher that repeats. `template` is the voucher's own create input without
 * the date; when `next_date` comes the worker makes a draft (never a posting).
 */
export const recurringSchedules = pgTable(
  "recurring_schedules",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    voucherType: voucherType("voucher_type").notNull(),
    template: jsonb("template").notNull(),
    frequency: recurringFrequency("frequency").notNull(),
    interval: integer("interval").notNull().default(1),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    maxCount: integer("max_count"),
    // Occurrences made or skipped; occurrence n is worked out from the start date.
    generatedCount: integer("generated_count").notNull().default(0),
    nextDate: date("next_date", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    lastSkippedOn: date("last_skipped_on", { mode: "string" }),
    sourceVoucherId: uuid("source_voucher_id"),
    // No foreign key: the schedule must outlive the user
    createdBy: uuid("created_by").notNull(),
    createdByName: text("created_by_name").notNull(),
    ...stamps,
  },
  (t) => [
    index("recurring_schedules_firm_idx").on(t.firmId, t.id),
    index("recurring_schedules_due_idx")
      .on(t.nextDate)
      .where(sql`${t.active} and ${t.nextDate} is not null`),
  ],
);

export const pendingEntryStatus = pgEnum("pending_entry_status", [
  "draft",
  "submitted",
  "rejected",
  "posted",
  "discarded",
]);
export const pendingEntrySource = pgEnum("pending_entry_source", [
  "recurring",
  "approval",
]);

/**
 * Entries not (yet) in the books: drafts made by a schedule and entries sent
 * for approval. They never touch balances or reports; posting creates a normal
 * voucher (numbered then) and keeps its id here. One draft per schedule and
 * date, so a retried or concurrent run never makes two.
 */
export const pendingEntries = pgTable(
  "pending_entries",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    voucherType: voucherType("voucher_type").notNull(),
    status: pendingEntryStatus("status").notNull(),
    source: pendingEntrySource("source").notNull(),
    scheduleId: uuid("schedule_id").references(() => recurringSchedules.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date", { mode: "string" }),
    date: date("date", { mode: "string" }).notNull(),
    partyId: uuid("party_id"),
    amount: paise("amount"),
    input: jsonb("input").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name").notNull(),
    submittedBy: uuid("submitted_by"),
    submittedByName: text("submitted_by_name"),
    submittedAt: moment("submitted_at"),
    reviewedBy: uuid("reviewed_by"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: moment("reviewed_at"),
    rejectReason: text("reject_reason"),
    voucherId: uuid("voucher_id"),
    // [{ action, at, userName, note }]
    history: jsonb("history").notNull().default([]),
    ...stamps,
  },
  (t) => [
    index("pending_entries_firm_status_idx").on(t.firmId, t.status),
    uniqueIndex("pending_entries_schedule_date_key").on(
      t.scheduleId,
      t.dueDate,
    ),
  ],
);

/** Which entry types need approval (doc 37, T06). No row: none. */
export const approvalControls = pgTable("approval_controls", {
  firmId: uuid("firm_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "restrict" }),
  types: text("types")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...stamps,
});

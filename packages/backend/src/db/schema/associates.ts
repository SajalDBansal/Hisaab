import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AssociateInput,
  AssociateFieldInput,
  CommissionSnapshot,
  DeliverySnapshot,
} from "@repo/contracts/src/associates";
import { organization } from "./auth";
import { accounts, bookScope, ledgers } from "./masters";
import { vouchers } from "./vouchers";
import { moment, paise, primaryId, quantity, stamps } from "./columns";

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
const day = (name: string) => date(name, { mode: "string" });

export const associates = pgTable(
  "associates",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    profile: jsonb("profile").$type<AssociateInput>().notNull(),
    payableAccountId: uuid("payable_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    ...stamps,
  },
  (t) => [
    index("associates_firm_name_idx").on(t.firmId, t.name),
    uniqueIndex("associates_payable_idx").on(t.firmId, t.payableAccountId),
    check("associates_version_check", sql`${t.version} > 0`),
  ],
);

export const associateFields = pgTable(
  "associate_fields",
  {
    id: primaryId(),
    firmId: firmId(),
    definition: jsonb("definition").$type<AssociateFieldInput>().notNull(),
    ...stamps,
  },
  (t) => [index("associate_fields_firm_idx").on(t.firmId)],
);

export const associateRules = pgTable(
  "associate_rules",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id")
      .notNull()
      .references(() => associates.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<CommissionSnapshot>().notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("associate_rules_version_idx").on(
      t.firmId,
      t.associateId,
      t.version,
    ),
  ],
);

export const deliveryAssignments = pgTable(
  "delivery_assignments",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id")
      .notNull()
      .references(() => associates.id, { onDelete: "restrict" }),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    voucherNumber: text("voucher_number").notNull(),
    date: day("date").notNull(),
    snapshot: jsonb("snapshot").$type<DeliverySnapshot>().notNull(),
    status: text("status", {
      enum: ["assigned", "dispatched", "delivered", "failed", "returned"],
    })
      .notNull()
      .default("assigned"),
    statusDate: day("status_date").notNull(),
    note: text("note").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...stamps,
  },
  (t) => [
    index("delivery_assignments_associate_idx").on(
      t.firmId,
      t.associateId,
      t.date,
    ),
    uniqueIndex("delivery_assignments_active_idx")
      .on(t.firmId, t.voucherId)
      .where(sql`${t.active}`),
    check(
      "delivery_assignments_status_check",
      sql`${t.status} in ('assigned','dispatched','delivered','failed','returned')`,
    ),
  ],
);

export const commissionAccruals = pgTable(
  "commission_accruals",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id")
      .notNull()
      .references(() => associates.id, { onDelete: "restrict" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    saleVersion: integer("sale_version").notNull(),
    lineIndex: integer("line_index").notNull(),
    bookScope: bookScope("book_scope").notNull(),
    date: day("date").notNull(),
    quantity: quantity("quantity").notNull(),
    basis: paise("basis"),
    earned: paise("earned"),
    snapshot: jsonb("snapshot").$type<CommissionSnapshot>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("commission_accruals_source_idx").on(
      t.firmId,
      t.saleId,
      t.saleVersion,
      t.lineIndex,
    ),
    index("commission_accruals_associate_idx").on(t.firmId, t.associateId),
    check(
      "commission_accruals_amounts_check",
      sql`${t.basis} between 0 and 9007199254740991 and ${t.earned} between 0 and 9007199254740991 and ${t.quantity} > 0 and ${t.lineIndex} >= 0 and ${t.saleVersion} > 0`,
    ),
  ],
);

export const associatePayouts = pgTable(
  "associate_payouts",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id")
      .notNull()
      .references(() => associates.id, { onDelete: "restrict" }),
    date: day("date").notNull(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "restrict" }),
    reference: text("reference").notNull().default(""),
    amount: paise("amount"),
    reversedOn: day("reversed_on"),
    reversalReason: text("reversal_reason"),
    ...stamps,
  },
  (t) => [
    index("associate_payouts_associate_idx").on(
      t.firmId,
      t.associateId,
      t.date,
    ),
    check(
      "associate_payouts_amount_check",
      sql`${t.amount} between 1 and 9007199254740991`,
    ),
  ],
);

export const commissionPayoutAllocations = pgTable(
  "commission_payout_allocations",
  {
    id: primaryId(),
    firmId: firmId(),
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => associatePayouts.id, { onDelete: "restrict" }),
    accrualId: uuid("accrual_id")
      .notNull()
      .references(() => commissionAccruals.id, { onDelete: "restrict" }),
    amount: paise("amount"),
  },
  (t) => [
    uniqueIndex("commission_payout_allocations_entry_idx").on(
      t.firmId,
      t.payoutId,
      t.accrualId,
    ),
    check(
      "commission_payout_allocations_amount_check",
      sql`${t.amount} between 1 and 9007199254740991`,
    ),
  ],
);

export const associateJournals = pgTable(
  "associate_journals",
  {
    id: primaryId(),
    firmId: firmId(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    sourceVoucherId: uuid("source_voucher_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    payoutId: uuid("payout_id").references(() => associatePayouts.id, {
      onDelete: "restrict",
    }),
    purpose: text("purpose").notNull(),
  },
  (t) => [
    uniqueIndex("associate_journals_journal_idx").on(t.firmId, t.journalId),
  ],
);

export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id")
      .notNull()
      .references(() => associates.id, { onDelete: "restrict" }),
    accrualId: uuid("accrual_id").references(() => commissionAccruals.id, {
      onDelete: "restrict",
    }),
    sourceVoucherId: uuid("source_voucher_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    payoutId: uuid("payout_id").references(() => associatePayouts.id, {
      onDelete: "restrict",
    }),
    journalId: uuid("journal_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    eventKey: text("event_key").notNull(),
    date: day("date").notNull(),
    bookScope: bookScope("book_scope").notNull(),
    kind: text("kind", {
      enum: ["earned", "adjustment", "payout", "payout-reversal"],
    }).notNull(),
    amount: paise("amount"),
    description: text("description").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("commission_entries_event_idx").on(t.firmId, t.eventKey),
    index("commission_entries_associate_idx").on(
      t.firmId,
      t.associateId,
      t.date,
    ),
    index("commission_entries_accrual_idx").on(t.firmId, t.accrualId),
    check(
      "commission_entries_amount_check",
      sql`${t.amount} between -9007199254740991 and 9007199254740991`,
    ),
    check(
      "commission_entries_kind_check",
      sql`${t.kind} in ('earned','adjustment','payout','payout-reversal')`,
    ),
  ],
);

export const associateEvents = pgTable(
  "associate_events",
  {
    id: primaryId(),
    firmId: firmId(),
    associateId: uuid("associate_id").references(() => associates.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    at: moment("at").notNull().defaultNow(),
  },
  (t) => [
    index("associate_events_associate_idx").on(t.firmId, t.associateId, t.id),
  ],
);

import { sql } from "drizzle-orm";
import {
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
import { organization } from "./auth";
import { accounts, parties } from "./masters";
import { loans } from "./loans";
import { vouchers } from "./vouchers";
import { openingBills } from "./importOpening";
import { moment, paise, primaryId } from "./columns";
import type { SettlementRecord } from "@repo/contracts/src/settlements";

export const settlementEntries = pgTable(
  "settlement_entries",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    kind: text("kind").$type<SettlementRecord["kind"]>().notNull(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    partyId: uuid("party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    sourceVoucherId: uuid("source_voucher_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    sourceEntryId: uuid("source_entry_id"),
    loanId: uuid("loan_id").references(() => loans.id, {
      onDelete: "restrict",
    }),
    interestAccountId: uuid("interest_account_id").references(
      () => accounts.id,
      { onDelete: "restrict" },
    ),
    installmentNumber: integer("installment_number"),
    date: date("date", { mode: "string" }).notNull(),
    bookScope: text("book_scope", { enum: ["gst", "nongst"] }).notNull(),
    amount: paise("amount"),
    reason: text("reason").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: moment("created_at").notNull().defaultNow(),
    details: jsonb("details").notNull(),
  },
  (t) => [
    uniqueIndex("settlement_entries_voucher_idx").on(t.voucherId),
    uniqueIndex("settlement_entries_reversal_idx")
      .on(t.sourceEntryId)
      .where(sql`${t.kind} = 'reversal'`),
    index("settlement_entries_firm_idx").on(t.firmId, t.id),
    index("settlement_entries_source_idx").on(t.firmId, t.sourceVoucherId),
    index("settlement_entries_loan_idx").on(
      t.firmId,
      t.loanId,
      t.installmentNumber,
    ),
    check(
      "settlement_entries_amount_check",
      sql`${t.amount} > 0 and ${t.amount} <= 9007199254740991 and ${t.version} = 1`,
    ),
    check(
      "settlement_entries_scope_check",
      sql`${t.bookScope} in ('gst','nongst')`,
    ),
  ],
);

export const settlementAllocations = pgTable(
  "settlement_allocations",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => settlementEntries.id, { onDelete: "restrict" }),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    billId: uuid("bill_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    openingPartyId: uuid("opening_party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    openingBillId: uuid("opening_bill_id").references(() => openingBills.id, {
      onDelete: "restrict",
    }),
    amount: paise("amount"),
  },
  (t) => [
    index("settlement_allocations_entry_idx").on(t.entryId),
    index("settlement_allocations_voucher_idx").on(t.firmId, t.voucherId),
    index("settlement_allocations_opening_bill_idx").on(
      t.firmId,
      t.openingBillId,
    ),
    check(
      "settlement_allocations_amount_check",
      sql`${t.amount} <> 0 and abs(${t.amount}) <= 9007199254740991`,
    ),
    check(
      "settlement_allocations_target_check",
      sql`num_nonnulls(${t.billId}, ${t.openingPartyId}, ${t.openingBillId}) = 1`,
    ),
  ],
);

export const creditApprovals = pgTable(
  "credit_approvals",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    partyVersion: integer("party_version").notNull(),
    saleHash: text("sale_hash").notNull(),
    creditLimit: paise("credit_limit"),
    projectedBalance: paise("projected_balance"),
    reason: text("reason").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
    expiresAt: moment("expires_at").notNull(),
  },
  (t) => [index("credit_approvals_firm_idx").on(t.firmId, t.id)],
);

export const creditApprovalUses = pgTable(
  "credit_approval_uses",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => creditApprovals.id, { onDelete: "restrict" }),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_approval_uses_voucher_idx").on(
      t.approvalId,
      t.voucherId,
    ),
    index("credit_approval_uses_approval_idx").on(t.firmId, t.approvalId),
  ],
);

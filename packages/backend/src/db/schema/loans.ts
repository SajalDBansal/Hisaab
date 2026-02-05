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
import type { LoanScheduleTerms } from "@repo/core/src/accounting/loanSchedule";
import { organization } from "./auth";
import { accounts } from "./masters";
import { vouchers } from "./vouchers";
import { moment, paise, primaryId, stamps } from "./columns";

export const loans = pgTable(
  "loans",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    direction: text("direction", { enum: ["borrowed", "lent"] }).notNull(),
    name: text("name").notNull(),
    counterparty: text("counterparty").notNull(),
    agreementReference: text("agreement_reference").notNull(),
    note: text("note").notNull(),
    terms: jsonb("terms").$type<LoanScheduleTerms>().notNull(),
    maturityDate: date("maturity_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("loans_firm_account_idx").on(t.firmId, t.accountId),
    uniqueIndex("loans_firm_name_idx").on(t.firmId, sql`lower(${t.name})`),
    index("loans_firm_id_idx").on(t.firmId, t.id),
    check("loans_direction_check", sql`${t.direction} in ('borrowed', 'lent')`),
    check("loans_status_check", sql`${t.status} in ('active', 'closed')`),
    check("loans_version_check", sql`${t.version} > 0`),
  ],
);

export const loanRepaymentReferences = pgTable(
  "loan_repayment_references",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    voucherVersion: integer("voucher_version").notNull(),
    voucherNumber: text("voucher_number").notNull(),
    voucherDate: date("voucher_date", { mode: "string" }).notNull(),
    installmentNumber: integer("installment_number").notNull(),
    principalConfirmed: boolean("principal_confirmed").notNull(),
    principal: paise("principal"),
    interest: paise("interest"),
    note: text("note").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
    removedAt: moment("removed_at"),
  },
  (t) => [
    uniqueIndex("loan_references_voucher_idx")
      .on(t.firmId, t.voucherId)
      .where(sql`${t.removedAt} is null`),
    index("loan_references_loan_idx").on(t.firmId, t.loanId),
    check(
      "loan_references_amounts_check",
      sql`${t.principal} > 0 and ${t.interest} >= 0 and ${t.principal} <= 9007199254740991 and ${t.interest} <= 9007199254740991`,
    ),
    check(
      "loan_references_installment_check",
      sql`${t.installmentNumber} between 1 and 600 and ${t.voucherVersion} > 0`,
    ),
    check(
      "loan_references_principal_confirmed_check",
      sql`${t.principalConfirmed}`,
    ),
  ],
);

export const loanEvents = pgTable(
  "loan_events",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    loanId: uuid("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "restrict" }),
    action: text("action", {
      enum: ["created", "updated", "reference-added", "reference-removed"],
    }).notNull(),
    reason: text("reason").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    at: moment("at").notNull().defaultNow(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
  },
  (t) => [index("loan_events_loan_idx").on(t.firmId, t.loanId, t.id)],
);

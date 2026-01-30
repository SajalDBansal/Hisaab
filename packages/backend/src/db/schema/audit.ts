import { index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment, primaryId } from "./columns";
import { voucherType, vouchers } from "./vouchers";

export const auditAction = pgEnum("audit_action", [
  "created",
  "edited",
  "cancelled",
  "converted",
  "reopened",
  "bank-date",
]);

/**
 * Edit history of every voucher (Companies (Accounts) Rules, Rule 3(1): kept 8 years).
 * Append-only: a database trigger (see migrations) rejects any update or delete.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    // Number and type at the time, so the log reads on its own
    number: text("number").notNull(),
    voucherType: voucherType("voucher_type").notNull(),
    action: auditAction("action").notNull(),
    at: moment("at").notNull().defaultNow(),
    // No foreign key: the log must outlive the user
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    // [{ field, before, after }]
    changes: jsonb("changes").notNull().default([]),
    note: text("note"),
  },
  (t) => [
    index("audit_log_voucher_idx").on(t.firmId, t.voucherId, t.at),
    index("audit_log_firm_at_idx").on(t.firmId, t.at),
  ],
);

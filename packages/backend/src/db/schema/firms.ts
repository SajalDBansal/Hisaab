import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { paise, stamps } from "./columns";

export const gstRegistration = pgEnum("gst_registration", [
  "regular",
  "composition",
  "unregistered",
]);
export const compositionType = pgEnum("composition_type", [
  "trader",
  "restaurant",
  "services",
]);
export const invoiceTemplate = pgEnum("invoice_template", [
  "classic",
  "modern",
  "compact",
]);

const firmKey = () =>
  uuid("firm_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "restrict" });

/** The business details. One row per firm (organization). */
export const firmProfile = pgTable("firm_profile", {
  firmId: firmKey(),
  city: text("city").notNull().default(""),
  state: text("state").notNull(),
  stateCode: text("state_code").notNull(),
  gstin: text("gstin").notNull().default(""),
  gstRegistration: gstRegistration("gst_registration").notNull(),
  compositionType: compositionType("composition_type"),
  // First day of the current financial year, e.g. 2026-04-01
  fyStart: date("fy_start", { mode: "string" }).notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  pan: text("pan"),
  ...stamps,
});

export const invoiceSettings = pgTable("invoice_settings", {
  firmId: firmKey(),
  template: invoiceTemplate("template").notNull().default("classic"),
  terms: text("terms").notNull().default(""),
  showBankDetails: boolean("show_bank_details").notNull().default(false),
  bankLedgerId: uuid("bank_ledger_id"),
  // { accountName, accountNumber, ifsc, upiId? }
  bankAccount: jsonb("bank_account"),
  // Voucher type -> prefix, e.g. { "sale": "SI" }
  prefixes: jsonb("prefixes").notNull(),
  billOfSupplyPrefix: text("bill_of_supply_prefix").notNull().default("BS"),
  ...stamps,
});

export const reminderSettings = pgTable("reminder_settings", {
  firmId: firmKey(),
  enabled: boolean("enabled").notNull().default(true),
  daysBefore: integer("days_before").notNull().default(3),
  onDueDate: boolean("on_due_date").notNull().default(true),
  repeatEvery: integer("repeat_every").notNull().default(7),
  minAmount: paise("min_amount"),
  ...stamps,
});

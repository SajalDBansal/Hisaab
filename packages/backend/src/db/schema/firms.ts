import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { paise, stamps } from "./columns";
import type { RoleRights } from "@repo/core";

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
  // Voucher type -> { start, digits, showYear }; missing types use the default format.
  numbering: jsonb("numbering").notNull().default({}),
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

// Logo and signature images for documents (doc 37, T16). Kept apart from
// invoice_settings so they are not copied into every voucher's frozen snapshot.
export const firmBranding = pgTable("firm_branding", {
  firmId: firmKey(),
  // data:image/png|jpeg;base64,… (up to about 150 KB each), or null
  logo: text("logo"),
  signature: text("signature"),
  ...stamps,
});

// Credit control for sales (doc 37, T11). The credit limit itself is on each
// party; this holds what overdue bills do to a new sale: off, warn or block.
export const overdueSalesPolicy = pgEnum("overdue_sales_policy", [
  "off",
  "warn",
  "block",
]);
export const salesControls = pgTable("sales_controls", {
  firmId: firmKey(),
  overdueSales: overdueSalesPolicy("overdue_sales").notNull().default("warn"),
  ...stamps,
});

// Custom roles (doc 37, T57). A member's `role` holds "r_<id>" for these; the
// built-in roles stay fixed in code. Rights: { permissions, vouchers, flags }.
export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id").primaryKey(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rights: jsonb("rights").$type<RoleRights>().notNull(),
    ...stamps,
  },
  (t) => [index("custom_roles_firm_idx").on(t.firmId)],
);

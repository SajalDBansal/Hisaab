import { sql } from "drizzle-orm";
import type { OpeningStockLot } from "@repo/core";
import {
  boolean,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment, paise, primaryId, quantity, stamps } from "./columns";

export const partyType = pgEnum("party_type", ["customer", "supplier"]);
export const bookScope = pgEnum("book_scope", ["gst", "nongst"]);
export const taxType = pgEnum("tax_type", [
  "taxable",
  "nil",
  "exempt",
  "nongst",
]);
export const ledgerKind = pgEnum("ledger_kind", ["cash", "bank"]);

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

export const parties = pgTable(
  "parties",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    type: partyType("type").notNull(),
    phone: text("phone").notNull().default(""),
    city: text("city").notNull().default(""),
    stateCode: text("state_code").notNull(),
    gstin: text("gstin"),
    creditDays: integer("credit_days").notNull().default(0),
    // 0 = no limit
    creditLimit: paise("credit_limit"),
    // Positive = they owe us, negative = we owe them
    openingBalance: paise("opening_balance"),
    openingGstBalance: bigint("opening_gst_balance", { mode: "number" }),
    openingDate: date("opening_date", { mode: "string" }).notNull(),
    deletedAt: moment("deleted_at"),
    ...stamps,
  },
  (t) => [
    // Two live parties can't share a name (ignoring capitals); deleted ones don't count
    uniqueIndex("parties_firm_name_idx")
      .on(t.firmId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("parties_firm_type_idx").on(t.firmId, t.type),
    index("parties_name_trgm_idx").using(
      "gin",
      sql`lower(${t.name}) gin_trgm_ops`,
    ),
    check(
      "parties_credit_check",
      sql`${t.creditDays} >= 0 and ${t.creditLimit} >= 0`,
    ),
    check(
      "parties_opening_gst_check",
      sql`${t.openingGstBalance} between least(0, ${t.openingBalance}) and greatest(0, ${t.openingBalance})`,
    ),
  ],
);

export const items = pgTable(
  "items",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    code: text("code").notNull().default(""),
    hsn: text("hsn").notNull().default(""),
    groupName: text("group_name").notNull().default(""),
    taxType: taxType("tax_type").notNull().default("taxable"),
    gstRate: integer("gst_rate").notNull().default(0),
    // Quantities are always stored in this base unit
    unit: text("unit").notNull(),
    altUnitName: text("alt_unit_name"),
    altUnitFactor: quantity("alt_unit_factor"),
    purchasePrice: paise("purchase_price"),
    salePrice: paise("sale_price"),
    mrp: paise("mrp"),
    reorderLevel: quantity("reorder_level").notNull().default(0),
    openingStock: quantity("opening_stock").notNull().default(0),
    openingCost: bigint("opening_cost", { mode: "number" }),
    openingBookScope: bookScope("opening_book_scope"),
    openingLots: jsonb("opening_lots").$type<OpeningStockLot[]>(),
    batchNumber: text("batch_number"),
    batchExpiry: date("batch_expiry", { mode: "string" }),
    deletedAt: moment("deleted_at"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("items_firm_name_idx")
      .on(t.firmId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("items_firm_code_idx")
      .on(t.firmId, t.code)
      .where(sql`${t.code} <> '' and ${t.deletedAt} is null`),
    index("items_name_trgm_idx").using(
      "gin",
      sql`lower(${t.name}) gin_trgm_ops`,
    ),
    check("items_gst_rate_check", sql`${t.gstRate} in (0, 5, 18, 40)`),
    check(
      "items_prices_check",
      sql`${t.purchasePrice} >= 0 and ${t.salePrice} >= 0 and ${t.mrp} >= 0`,
    ),
  ],
);

/** Units of measure a firm uses (Nos, Kg ...). Items store the unit name. */
export const units = pgTable(
  "units",
  {
    firmId: firmId(),
    name: text("name").notNull(),
    // GST unit quantity code, e.g. KGS
    uqc: text("uqc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    builtIn: boolean("built_in").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.name] })],
);

/** Cash and bank accounts. */
export const ledgers = pgTable(
  "ledgers",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    kind: ledgerKind("kind").notNull(),
    shortName: text("short_name").notNull(),
    openingBalance: paise("opening_balance"),
    openingGstBalance: bigint("opening_gst_balance", { mode: "number" }),
    deletedAt: moment("deleted_at"),
    ...stamps,
  },
  (t) => [
    uniqueIndex("ledgers_firm_name_idx")
      .on(t.firmId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    check(
      "ledgers_opening_gst_check",
      sql`${t.openingGstBalance} between least(0, ${t.openingBalance}) and greatest(0, ${t.openingBalance})`,
    ),
  ],
);

/** Opening balance of other accounts (furniture, loans ...). Capital balances them. */
export const openingAccounts = pgTable(
  "opening_accounts",
  {
    firmId: firmId(),
    // Account key, e.g. "asset:Furniture"
    account: text("account").notNull(),
    // Positive = Dr, negative = Cr
    amount: paise("amount"),
    openingGstAmount: bigint("opening_gst_amount", { mode: "number" }),
  },
  (t) => [
    primaryKey({ columns: [t.firmId, t.account] }),
    check(
      "opening_accounts_gst_check",
      sql`${t.openingGstAmount} between least(0, ${t.amount}) and greatest(0, ${t.amount})`,
    ),
  ],
);

/** User-created non-trade accounts; their postings use the stable account:<id> key. */
export const accounts = pgTable(
  "accounts",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    group: text("group_name").notNull(),
    openingBalance: paise("opening_balance"),
    openingGstBalance: bigint("opening_gst_balance", { mode: "number" }),
    contactName: text("contact_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    note: text("note").notNull().default(""),
    ...stamps,
  },
  (t) => [
    uniqueIndex("accounts_firm_name_idx").on(t.firmId, sql`lower(${t.name})`),
    check(
      "accounts_opening_gst_check",
      sql`${t.openingGstBalance} between least(0, ${t.openingBalance}) and greatest(0, ${t.openingBalance})`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import type {
  CommissionSnapshot,
  DeliverySnapshot,
  InventoryAdjustment,
  VoucherSnapshot,
} from "@repo/core";
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
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment, paise, percent, primaryId, quantity, stamps } from "./columns";
import { ledgers, parties, items, taxType, bookScope } from "./masters";
import { openingBills } from "./importOpening";

export const voucherType = pgEnum("voucher_type", [
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "credit-note",
  "debit-note",
  "contra",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
]);
export const voucherStatus = pgEnum("voucher_status", [
  "draft",
  "posted",
  "cancelled",
]);
export const paymentMode = pgEnum("payment_mode", [
  "cash",
  "upi",
  "bank",
  "cheque",
  "card",
]);
export const saleDocType = pgEnum("sale_doc_type", [
  "tax-invoice",
  "bill-of-supply",
  "invoice",
]);
export const gstMode = pgEnum("gst_mode", ["regular", "composition", "off"]);

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

/**
 * Next bill number for each firm, voucher type, series and financial year.
 * The row is locked while a number is taken, so two phones never get the same one.
 */
export const voucherCounters = pgTable(
  "voucher_counters",
  {
    firmId: firmId(),
    type: voucherType("type").notNull(),
    // Prefix such as "SI" or "BS"
    series: text("series").notNull(),
    // Financial year, e.g. "26-27"
    financialYear: text("financial_year").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.firmId, t.type, t.series, t.financialYear] }),
  ],
);

/** Every entry in the books: bills, payments, journals, and orders that haven't become bills yet. */
export const vouchers = pgTable(
  "vouchers",
  {
    id: primaryId(),
    firmId: firmId(),
    type: voucherType("type").notNull(),
    // Printed number, e.g. SI/26-27/0149
    number: text("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: voucherStatus("status").notNull().default("posted"),
    partyId: uuid("party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    // Final amount in paise (invoices: the rounded grand total)
    amount: paise("amount"),
    narration: text("narration"),
    snapshot: jsonb("snapshot").$type<VoucherSnapshot>(),
    inventoryAdjustment: jsonb(
      "inventory_adjustment",
    ).$type<InventoryAdjustment>(),
    delivery: jsonb("delivery").$type<DeliverySnapshot>(),
    commission: jsonb("commission").$type<CommissionSnapshot>(),

    // Sale / purchase
    interState: boolean("inter_state"),
    dueDate: date("due_date", { mode: "string" }),
    supplierInvoiceNo: text("supplier_invoice_no"),
    docType: saleDocType("doc_type"),
    // The firm's GST mode when saved, so changing the setting later never alters old bills
    taxMode: gstMode("tax_mode"),
    bookScope: bookScope("book_scope"),

    // Credit / debit notes
    againstId: uuid("against_id").references((): AnyPgColumn => vouchers.id, {
      onDelete: "restrict",
    }),
    noteReason: text("note_reason"),

    // Cancel and edit marks
    cancelReason: text("cancel_reason"),
    cancelledAt: moment("cancelled_at"),
    editedAt: moment("edited_at"),

    // Estimates and orders
    validUntil: date("valid_until", { mode: "string" }),
    sourceId: uuid("source_id").references((): AnyPgColumn => vouchers.id, {
      onDelete: "restrict",
    }),
    convertedToId: uuid("converted_to_id").references(
      (): AnyPgColumn => vouchers.id,
      { onDelete: "restrict" },
    ),

    // Receipt / payment / expense / contra
    mode: paymentMode("mode"),
    ledgerId: uuid("ledger_id").references(() => ledgers.id, {
      onDelete: "restrict",
    }),
    // Contra: the account the money went into (ledgerId is where it came from)
    toLedgerId: uuid("to_ledger_id").references(() => ledgers.id, {
      onDelete: "restrict",
    }),
    reference: text("reference"),
    expenseHead: text("expense_head"),
    // Bank reconciliation: the date it showed in the bank statement
    clearedOn: date("cleared_on", { mode: "string" }),
    bankClearings: jsonb("bank_clearings").$type<Record<string, string>>(),
    // Payments only: tax deducted at source
    tdsSection: text("tds_section"),
    tdsRate: percent("tds_rate"),
    tdsAmount: paise("tds_amount"),

    createdBy: uuid("created_by"),
    ...stamps,
  },
  (t) => [
    // No duplicate bill numbers, ever
    uniqueIndex("vouchers_firm_type_number_idx").on(t.firmId, t.type, t.number),
    index("vouchers_firm_date_id_idx").on(t.firmId, t.date.desc(), t.id.desc()),
    index("vouchers_firm_party_date_idx").on(t.firmId, t.partyId, t.date),
    index("vouchers_firm_type_date_idx").on(t.firmId, t.type, t.date.desc()),
    check(
      "vouchers_amount_check",
      sql`${t.amount} >= 0 and ${t.tdsAmount} >= 0`,
    ),
    check(
      "vouchers_contra_check",
      sql`${t.type} <> 'contra' or ${t.ledgerId} <> ${t.toLedgerId}`,
    ),
  ],
);

/** Item rows on a bill or order. */
export const voucherLines = pgTable(
  "voucher_lines",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    // Quantity and rate are in `perUnit` when set, otherwise in the item's base unit
    qty: quantity("qty").notNull(),
    rate: paise("rate"),
    perUnit: text("per_unit"),
    perFactor: quantity("per_factor"),
    discountPercent: percent("discount_percent"),
    discountAmount: paise("discount_amount"),
    gstRate: integer("gst_rate").notNull().default(0),
    taxType: taxType("tax_type"),
    // Credit/debit notes: index of the returned line on the original bill
    sourceLine: smallint("source_line"),
    stockLotId: text("stock_lot_id"),
    stockCost: bigint("stock_cost", { mode: "number" }),
    bookScope: bookScope("book_scope"),
  },
  (t) => [
    uniqueIndex("voucher_lines_position_idx").on(t.voucherId, t.position),
    index("voucher_lines_item_idx").on(t.firmId, t.itemId),
  ],
);

/** Freight, packing and other charges on a bill. */
export const voucherCharges = pgTable(
  "voucher_charges",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    name: text("name").notNull(),
    amount: paise("amount"),
    gstRate: integer("gst_rate").notNull().default(0),
  },
  (t) => [
    uniqueIndex("voucher_charges_position_idx").on(t.voucherId, t.position),
  ],
);

/** The free Dr/Cr lines of a journal entry. */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    account: text("account").notNull(),
    name: text("name").notNull(),
    debit: paise("debit"),
    credit: paise("credit"),
  },
  (t) => [
    uniqueIndex("journal_lines_position_idx").on(t.voucherId, t.position),
    check(
      "journal_lines_side_check",
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and not (${t.debit} > 0 and ${t.credit} > 0)`,
    ),
  ],
);

/** Money from a receipt or payment that settles a particular bill. */
export const allocations = pgTable(
  "allocations",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    // Exactly one target: invoice, legacy net opening or imported opening bill.
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
    index("allocations_bill_idx").on(t.firmId, t.billId),
    index("allocations_voucher_idx").on(t.voucherId),
    check("allocations_amount_check", sql`${t.amount} > 0`),
    check(
      "allocations_target_check",
      sql`num_nonnulls(${t.billId}, ${t.openingPartyId}, ${t.openingBillId}) = 1`,
    ),
    index("allocations_opening_idx").on(t.firmId, t.openingPartyId),
    index("allocations_opening_bill_idx").on(t.firmId, t.openingBillId),
  ],
);

/** Dr/Cr per account for each voucher. Every balance and report adds these up. */
export const postings = pgTable(
  "postings",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    // Account key, e.g. "sales", "party:<id>", "ledger:<id>"
    account: text("account").notNull(),
    // Name at the time, so old statements read the same later
    ledgerName: text("ledger_name").notNull(),
    debit: paise("debit"),
    credit: paise("credit"),
    // Copied from the voucher so reports can filter without a join
    date: date("date", { mode: "string" }).notNull(),
  },
  (t) => [
    index("postings_account_idx").on(t.firmId, t.account, t.date),
    index("postings_voucher_idx").on(t.voucherId),
    check(
      "postings_side_check",
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and not (${t.debit} > 0 and ${t.credit} > 0)`,
    ),
  ],
);

/** Stock in (+) or out (-) per item per voucher, in the item's base unit. Stock = opening + sum. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: primaryId(),
    firmId: firmId(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    qty: quantity("qty").notNull(),
  },
  (t) => [
    index("stock_movements_item_idx").on(t.firmId, t.itemId, t.date),
    index("stock_movements_voucher_idx").on(t.voucherId),
  ],
);

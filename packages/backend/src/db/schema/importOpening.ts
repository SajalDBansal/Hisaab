import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { parties } from "./masters";
import { moment } from "./columns";

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

/** Immutable provenance for the one-time initialization of a monetary opening. */
export const importedOpeningBalances = pgTable(
  "imported_opening_balances",
  {
    id: uuid("id").primaryKey(),
    firmId: firmId(),
    batchId: uuid("batch_id").notNull(),
    targetKind: text("target_kind")
      .$type<"party" | "ledger" | "account">()
      .notNull(),
    targetId: uuid("target_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    gstAmount: bigint("gst_amount", { mode: "number" }).notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("imported_opening_balances_target_idx").on(
      t.firmId,
      t.targetKind,
      t.targetId,
    ),
    check(
      "imported_opening_balances_kind_check",
      sql`${t.targetKind} in ('party','ledger','account')`,
    ),
    check(
      "imported_opening_balances_amount_check",
      sql`${t.amount} <> 0 and abs(${t.amount}) <= 1000000000000 and ${t.gstAmount} between least(0, ${t.amount}) and greatest(0, ${t.amount})`,
    ),
  ],
);

/** Subledger partitions of the party's existing opening, not financial vouchers. */
export const openingBills = pgTable(
  "opening_bills",
  {
    id: uuid("id").primaryKey(),
    firmId: firmId(),
    batchId: uuid("batch_id").notNull(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    openingDate: date("opening_date", { mode: "string" }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    gstAmount: bigint("gst_amount", { mode: "number" }).notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("opening_bills_number_idx").on(
      t.firmId,
      t.partyId,
      sql`lower(${t.number})`,
    ),
    index("opening_bills_party_idx").on(t.firmId, t.partyId),
    check(
      "opening_bills_amount_check",
      sql`${t.amount} > 0 and ${t.amount} <= 1000000000000 and ${t.gstAmount} between 0 and ${t.amount}`,
    ),
    check(
      "opening_bills_date_check",
      sql`${t.date} <= ${t.openingDate} and ${t.dueDate} >= ${t.date}`,
    ),
  ],
);

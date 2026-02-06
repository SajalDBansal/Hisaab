import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ImportApplyResult } from "@repo/contracts/src/imports";
import { organization } from "../../db/schema/auth";
import { moment } from "../../db/schema/columns";

/** Durable receipts: never purge with the seven-day voucher retry cache. */
export const masterImportBatches = pgTable(
  "master_import_batches",
  {
    id: uuid("id").primaryKey(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    // Retain attribution even if the account is later removed.
    userId: uuid("user_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    fileHash: text("file_hash").notNull(),
    kind: text("kind").notNull(),
    result: jsonb("result").$type<ImportApplyResult>().notNull(),
    appliedAt: moment("applied_at").notNull(),
  },
  (t) => [
    uniqueIndex("master_import_batches_user_key_idx").on(
      t.userId,
      t.requestKey,
    ),
    index("master_import_batches_firm_idx").on(t.firmId, t.appliedAt),
    check(
      "master_import_batches_kind_check",
      sql`${t.kind} in ('customers', 'suppliers', 'items', 'opening-balances', 'open-bills', 'opening-stock')`,
    ),
  ],
);

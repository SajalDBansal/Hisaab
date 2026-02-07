import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { moment } from "./columns";

// These receipts are business retry identities, not expiring request-cache entries.
export const operationReceipts = pgTable(
  "operation_receipts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    firmId: uuid("firm_id").references(() => organization.id, {
      onDelete: "restrict",
    }),
    role: text("role"),
    requestHash: text("request_hash").notNull(),
    legacy: integer("legacy").notNull().default(0),
    result: jsonb("result").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("operation_receipts_firm_idx").on(t.firmId, t.userId),
  ],
);

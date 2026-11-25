import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { primaryId, stamps } from "./columns";

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

/**
 * Salespersons (doc 37, T10). `user_id` links one to a login of the firm (no
 * foreign key: members come and go, the salesperson stays on old entries).
 * Switched off rather than deleted, since vouchers keep pointing at them.
 */
export const salespersons = pgTable(
  "salespersons",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    userId: uuid("user_id"),
    phone: text("phone").notNull().default(""),
    active: boolean("active").notNull().default(true),
    ...stamps,
  },
  (t) => [
    index("salespersons_firm_idx").on(t.firmId),
    uniqueIndex("salespersons_firm_name_idx").on(
      t.firmId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("salespersons_firm_user_idx")
      .on(t.firmId, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

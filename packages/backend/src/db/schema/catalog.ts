import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  numeric,
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

/**
 * Price lists (doc 37, T36): a sale or purchase list, either a percentage on
 * the item's own price or per-item rates (`rates`: { itemId, rate, unit? }).
 * At most one default list per side; parties point at theirs.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    side: text("side", { enum: ["sale", "purchase"] }).notNull(),
    mode: text("mode", { enum: ["percent", "rates"] }).notNull(),
    percent: numeric("percent", { precision: 7, scale: 3, mode: "number" }),
    rates: jsonb("rates")
      .$type<{ itemId: string; rate: number; unit?: string }[]>()
      .notNull()
      .default([]),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...stamps,
  },
  (t) => [
    uniqueIndex("price_lists_firm_name_idx").on(
      t.firmId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex("price_lists_firm_default_idx")
      .on(t.firmId, t.side)
      .where(sql`${t.isDefault}`),
    check("price_lists_side_check", sql`${t.side} in ('sale','purchase')`),
    check("price_lists_mode_check", sql`${t.mode} in ('percent','rates')`),
  ],
);

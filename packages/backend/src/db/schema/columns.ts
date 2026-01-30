import { bigint, integer, numeric, timestamp, uuid } from "drizzle-orm/pg-core";

// Small column helpers so every table spells the same thing the same way.

/** Primary key. The app generates it (UUID v7, so ids sort by time and index well). */
export const primaryId = () => uuid("id").primaryKey();

/** Money: whole paise (₹12.50 is 1250). Never floats. */
export const paise = (name: string) =>
  bigint(name, { mode: "number" }).notNull().default(0);

/** Quantities can have decimals (2.5 kg), so three digits after the point. */
export const quantity = (name: string) =>
  numeric(name, { precision: 14, scale: 3, mode: "number" });

/** Percentages such as discounts and TDS rates. */
export const percent = (name: string) =>
  numeric(name, { precision: 6, scale: 3, mode: "number" });

export const moment = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** created_at, updated_at and version. `version` goes up by 1 on every change (used by If-Match). */
export const stamps = {
  createdAt: moment("created_at").notNull().defaultNow(),
  updatedAt: moment("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  version: integer("version").notNull().default(1),
};

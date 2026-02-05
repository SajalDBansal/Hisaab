import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment, primaryId } from "./columns";

export const bookControls = pgTable("book_controls", {
  firmId: uuid("firm_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "restrict" }),
  closedThrough: date("closed_through", { mode: "string" }),
  openingApprovedAt: moment("opening_approved_at"),
  openingApprovedBy: text("opening_approved_by"),
  version: integer("version").notNull().default(0),
});

// Control history is append-only, including every reopening reason.
export const bookControlEvents = pgTable(
  "book_control_events",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    at: moment("at").notNull().defaultNow(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
  },
  (t) => [index("book_control_events_firm_idx").on(t.firmId, t.id)],
);

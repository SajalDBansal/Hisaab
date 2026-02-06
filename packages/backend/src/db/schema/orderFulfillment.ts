import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { InvoiceLine } from "@repo/core";
import type { OrderFulfillmentResult } from "@repo/contracts/src/orderFulfillment";
import { organization } from "./auth";
import { vouchers } from "./vouchers";
import { moment, primaryId, quantity } from "./columns";

export const orderSourceLines = pgTable(
  "order_source_lines",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    line: jsonb("line").$type<InvoiceLine>().notNull(),
  },
  (t) => [
    uniqueIndex("order_source_lines_position_idx").on(
      t.firmId,
      t.sourceId,
      t.position,
    ),
    index("order_source_lines_source_idx").on(t.firmId, t.sourceId),
    check("order_source_lines_position_check", sql`${t.position} >= 0`),
  ],
);

/** A permanent retry receipt, retained even when children are later cancelled. */
export const orderFulfillments = pgTable(
  "order_fulfillments",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    userName: text("user_name").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<OrderFulfillmentResult>().notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_fulfillments_retry_idx").on(t.firmId, t.userId, t.key),
    index("order_fulfillments_source_idx").on(t.firmId, t.sourceId),
  ],
);

export const orderFulfillmentLines = pgTable(
  "order_fulfillment_lines",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    fulfillmentId: uuid("fulfillment_id")
      .notNull()
      .references(() => orderFulfillments.id, { onDelete: "restrict" }),
    sourceLineId: uuid("source_line_id")
      .notNull()
      .references(() => orderSourceLines.id, { onDelete: "restrict" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "restrict" }),
    targetPosition: integer("target_position").notNull(),
    qty: quantity("qty").notNull(),
    stockFulfilledById: uuid("stock_fulfilled_by_id").references(
      () => vouchers.id,
      { onDelete: "restrict" },
    ),
  },
  (t) => [
    uniqueIndex("order_fulfillment_lines_target_idx").on(
      t.firmId,
      t.targetId,
      t.targetPosition,
    ),
    index("order_fulfillment_lines_source_idx").on(t.firmId, t.sourceLineId),
    index("order_fulfillment_lines_receipt_idx").on(t.fulfillmentId),
    check("order_fulfillment_lines_qty_check", sql`${t.qty} > 0`),
    check(
      "order_fulfillment_lines_position_check",
      sql`${t.targetPosition} >= 0`,
    ),
  ],
);

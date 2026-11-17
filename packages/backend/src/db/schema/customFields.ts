import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CustomFieldInput } from "@repo/contracts";
import { organization } from "./auth";
import { primaryId, stamps } from "./columns";

/**
 * Custom field definitions for parties, items and voucher headers (doc 37, T07).
 * Values live on those rows, keyed by `key`, which never changes. Fields are
 * switched off rather than deleted, so stored values keep their meaning.
 */
export const customFields = pgTable(
  "custom_fields",
  {
    id: primaryId(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    entity: text("entity", { enum: ["party", "item", "voucher"] }).notNull(),
    definition: jsonb("definition")
      .$type<Omit<CustomFieldInput, "entity">>()
      .notNull(),
    position: integer("position").notNull().default(0),
    ...stamps,
  },
  (t) => [
    uniqueIndex("custom_fields_firm_key_idx").on(t.firmId, t.key),
    index("custom_fields_firm_entity_idx").on(t.firmId, t.entity, t.position),
  ],
);

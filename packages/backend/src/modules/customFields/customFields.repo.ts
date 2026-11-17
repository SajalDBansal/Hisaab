import { asc, eq } from "drizzle-orm";
import type { CustomFieldDef } from "@repo/core";
import type { Db } from "../../db/client";
import { customFields } from "../../db/schema/customFields";

type Row = typeof customFields.$inferSelect;

export function toCustomFieldDef(row: Row): CustomFieldDef {
  return {
    id: row.id,
    key: row.key,
    entity: row.entity,
    name: row.definition.name,
    kind: row.definition.kind,
    choices: row.definition.choices ?? [],
    required: row.definition.required ?? false,
    active: row.definition.active ?? true,
    print: row.definition.print ?? false,
    voucherTypes: row.definition.voucherTypes ?? [],
    position: row.position,
    version: row.version,
  };
}

/** Every custom field of the firm (active or not), in display order (doc 37, T07). */
export async function loadCustomFieldDefs(
  db: Pick<Db, "select">,
  firmId: string,
): Promise<CustomFieldDef[]> {
  const rows = await db
    .select()
    .from(customFields)
    .where(eq(customFields.firmId, firmId))
    .orderBy(
      asc(customFields.entity),
      asc(customFields.position),
      asc(customFields.id),
    );
  return rows.map(toCustomFieldDef);
}

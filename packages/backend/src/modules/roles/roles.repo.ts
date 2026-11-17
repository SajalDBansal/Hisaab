import { and, asc, eq } from "drizzle-orm";
import {
  isCustomRoleId,
  registerRoles,
  type CustomRoleId,
  type RoleDefinition,
} from "@repo/core";
import type { Db } from "../../db/client";
import { customRoles } from "../../db/schema/firms";

type Row = typeof customRoles.$inferSelect;

export const roleIdOf = (row: Pick<Row, "id">): CustomRoleId => `r_${row.id}`;

export function toRoleDefinition(row: Row): RoleDefinition {
  return {
    id: roleIdOf(row),
    name: row.name,
    description: row.description,
    version: row.version,
    permissions: row.rights.permissions,
    vouchers: row.rights.vouchers,
    flags: row.rights.flags,
  };
}

/** Every custom role of the firm, by name (doc 37, T57). */
export async function loadCustomRoles(
  db: Pick<Db, "select">,
  firmId: string,
): Promise<RoleDefinition[]> {
  const rows = await db
    .select()
    .from(customRoles)
    .where(eq(customRoles.firmId, firmId))
    .orderBy(asc(customRoles.name));
  return rows.map(toRoleDefinition);
}

/**
 * Before checking a member's rights: load their custom role (if any) from this
 * firm and refresh it in the shared registry. A custom role that doesn't belong
 * to the firm is never registered, so it grants nothing.
 */
export async function refreshMemberRole(
  db: Pick<Db, "select">,
  firmId: string,
  role: string,
): Promise<void> {
  if (!isCustomRoleId(role)) return;
  const [row] = await db
    .select()
    .from(customRoles)
    .where(
      and(eq(customRoles.firmId, firmId), eq(customRoles.id, role.slice(2))),
    );
  if (row) registerRoles([toRoleDefinition(row)]);
}

import { asc, eq } from "drizzle-orm";
import type { Salesperson } from "@repo/core";
import type { Db } from "../../db/client";
import { salespersons } from "../../db/schema/catalog";

type SalespersonRow = typeof salespersons.$inferSelect;

export const toSalesperson = (row: SalespersonRow): Salesperson => ({
  id: row.id,
  name: row.name,
  ...(row.userId ? { userId: row.userId } : {}),
  ...(row.phone ? { phone: row.phone } : {}),
  active: row.active,
  version: row.version,
});

/** Every salesperson of the firm (doc 37, T10), active or not, by name. */
export async function loadSalespersons(
  db: Pick<Db, "select">,
  firmId: string,
): Promise<Salesperson[]> {
  const rows = await db
    .select()
    .from(salespersons)
    .where(eq(salespersons.firmId, firmId))
    .orderBy(asc(salespersons.name), asc(salespersons.id));
  return rows.map(toSalesperson);
}

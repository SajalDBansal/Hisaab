import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";

const { units, items } = schema;

export const unitsRepo = {
  async list(db: Pick<Db, "select">, firmId: string) {
    return db
      .select()
      .from(units)
      .where(eq(units.firmId, firmId))
      .orderBy(desc(units.enabled), desc(units.builtIn), asc(units.name));
  },

  async get(db: Db, firmId: string, name: string) {
    const [row] = await db
      .select()
      .from(units)
      .where(and(eq(units.firmId, firmId), eq(units.name, name)));
    return row;
  },

  async insert(db: Db, row: typeof units.$inferInsert) {
    await db.insert(units).values(row);
  },

  async setEnabled(db: Db, firmId: string, name: string, enabled: boolean) {
    await db
      .update(units)
      .set({ enabled })
      .where(and(eq(units.firmId, firmId), eq(units.name, name)));
  },

  async remove(db: Db, firmId: string, name: string) {
    await db
      .delete(units)
      .where(and(eq(units.firmId, firmId), eq(units.name, name)));
  },

  /** How many live items use each unit as the main or second unit. */
  async usage(db: Db, firmId: string): Promise<Record<string, number>> {
    const rows = await db.execute<{ name: string; n: string }>(sql`
      select u.name, count(i.id) as n
      from ${units} u
      left join ${items} i
        on i.firm_id = u.firm_id and i.deleted_at is null
       and (i.unit = u.name or i.alt_unit_name = u.name)
      where u.firm_id = ${firmId}
      group by u.name`);
    return Object.fromEntries(rows.rows.map((r) => [r.name, Number(r.n)]));
  },
};

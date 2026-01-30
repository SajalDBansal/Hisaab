import {
  and,
  asc,
  eq,
  getTableColumns,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";

const { items, stockMovements, voucherLines } = schema;
export type ItemDb = Pick<Db, "select" | "insert" | "update" | "execute">;

// Stock = opening stock + every movement from a posted voucher. Never stored, always worked out.
const stock = sql<string>`items.opening_stock + coalesce((
  select sum(stock_movements.qty)
  from stock_movements
  join vouchers on vouchers.id = stock_movements.voucher_id
  where stock_movements.firm_id = items.firm_id
    and stock_movements.item_id = items.id
    and vouchers.status = 'posted'), 0)`;

const columns = { ...getTableColumns(items), stock };
export type ItemRecord = Omit<typeof items.$inferSelect, "stock"> & {
  stock: string;
};

const live = (firmId: string) =>
  and(eq(items.firmId, firmId), isNull(items.deletedAt));

export const itemsRepo = {
  async list(
    db: ItemDb,
    firmId: string,
    f: { search?: string; lowStock?: boolean; limit: number; offset: number },
  ): Promise<ItemRecord[]> {
    const search = f.search?.trim();
    return db
      .select(columns)
      .from(items)
      .where(
        and(
          live(firmId),
          search
            ? or(
                sql`lower(${items.name}) like lower(${`%${search}%`})`,
                sql`${items.code} ilike ${`%${search}%`}`,
              )
            : undefined,
          f.lowStock ? sql`${stock} < ${items.reorderLevel}` : undefined,
        ),
      )
      .orderBy(asc(sql`lower(${items.name})`), asc(items.id))
      .limit(f.limit + 1)
      .offset(f.offset);
  },

  async get(db: ItemDb, firmId: string, id: string) {
    const [row] = await db
      .select(columns)
      .from(items)
      .where(and(live(firmId), eq(items.id, id)));
    return row;
  },

  /** Live items with the same name or code. */
  async clashes(
    db: ItemDb,
    firmId: string,
    i: { name: string; code: string },
    exceptId?: string,
  ) {
    return db
      .select()
      .from(items)
      .where(
        and(
          live(firmId),
          exceptId ? ne(items.id, exceptId) : undefined,
          or(
            sql`lower(${items.name}) = lower(${i.name})`,
            i.code ? sql`lower(${items.code}) = lower(${i.code})` : undefined,
          ),
        ),
      );
  },

  async insert(db: ItemDb, row: typeof items.$inferInsert) {
    await db.insert(items).values(row);
  },

  async update(
    db: ItemDb,
    firmId: string,
    id: string,
    version: number,
    patch: Partial<typeof items.$inferInsert>,
  ) {
    const rows = await db
      .update(items)
      .set({ ...patch, version: sql`${items.version} + 1` })
      .where(and(live(firmId), eq(items.id, id), eq(items.version, version)))
      .returning({ id: items.id });
    return rows.length > 0;
  },

  /** Has this item been on any bill or stock entry? */
  async hasEntries(db: ItemDb, firmId: string, id: string) {
    const [row] = await db
      .execute<{ used: boolean }>(
        sql`select (
          exists (select 1 from ${voucherLines} where ${voucherLines.firmId} = ${firmId} and ${voucherLines.itemId} = ${id})
          or exists (select 1 from ${stockMovements} where ${stockMovements.firmId} = ${firmId} and ${stockMovements.itemId} = ${id})
        ) as used`,
      )
      .then((r) => r.rows);
    return row?.used === true;
  },
};

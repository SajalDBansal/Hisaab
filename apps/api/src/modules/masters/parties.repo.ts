import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import type { OpeningBill } from "@repo/core/src/accounting/openingImport";
import { loadOpeningBills } from "@repo/backend/modules/imports/imports.opening-bills";

const { parties, vouchers, postings } = schema;

// Balance = opening balance + everything posted to this party. Never stored, always worked out.
const balance = sql<string>`parties.opening_balance + coalesce((
  select sum(postings.debit - postings.credit)
  from postings
  join vouchers on vouchers.id = postings.voucher_id
  where postings.firm_id = parties.firm_id
    and postings.account = 'party:' || parties.id::text
    and vouchers.status = 'posted'), 0)`;

const columns = { ...getTableColumns(parties), balance };
export type PartyRecord = Omit<typeof parties.$inferSelect, "balance"> & {
  balance: string;
  openingBills?: OpeningBill[];
};

const live = (firmId: string) =>
  and(eq(parties.firmId, firmId), isNull(parties.deletedAt));

export const partiesRepo = {
  async list(
    db: Pick<Db, "select">,
    firmId: string,
    f: {
      type?: "customer" | "supplier";
      search?: string;
      sort: "name" | "balance";
      limit: number;
      offset: number;
    },
  ): Promise<PartyRecord[]> {
    const search = f.search?.trim();
    const rows = await db
      .select(columns)
      .from(parties)
      .where(
        and(
          live(firmId),
          f.type ? eq(parties.type, f.type) : undefined,
          search
            ? or(
                sql`lower(${parties.name}) like lower(${`%${search}%`})`,
                sql`${parties.phone} like ${`%${search}%`}`,
              )
            : undefined,
        ),
      )
      .orderBy(
        ...(f.sort === "balance"
          ? [desc(sql`abs(${balance})`), asc(parties.name)]
          : [asc(sql`lower(${parties.name})`), asc(parties.id)]),
      )
      .limit(f.limit + 1)
      .offset(f.offset);
    const bills = await loadOpeningBills(
      db,
      firmId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, openingBills: bills.get(r.id) }));
  },

  async get(db: Pick<Db, "select">, firmId: string, id: string) {
    const [row] = await db
      .select(columns)
      .from(parties)
      .where(and(live(firmId), eq(parties.id, id)));
    if (!row) return undefined;
    const bills = await loadOpeningBills(db, firmId, [id]);
    return { ...row, openingBills: bills.get(id) };
  },

  /** Live parties that could clash with this one (same name, or same GSTIN and type). */
  async clashes(
    db: Pick<Db, "select">,
    firmId: string,
    p: { name: string; gstin?: string | null },
    exceptId?: string,
  ) {
    return db
      .select()
      .from(parties)
      .where(
        and(
          live(firmId),
          exceptId ? ne(parties.id, exceptId) : undefined,
          or(
            sql`lower(${parties.name}) = lower(${p.name})`,
            p.gstin ? eq(parties.gstin, p.gstin) : undefined,
          ),
        ),
      );
  },

  async insert(db: Pick<Db, "insert">, row: typeof parties.$inferInsert) {
    await db.insert(parties).values(row);
  },

  /** Saves only if nobody changed the party since the caller loaded it. Returns false when they did. */
  async update(
    db: Pick<Db, "update">,
    firmId: string,
    id: string,
    version: number,
    patch: Partial<typeof parties.$inferInsert>,
  ) {
    const rows = await db
      .update(parties)
      .set({ ...patch, version: sql`${parties.version} + 1` })
      .where(
        and(live(firmId), eq(parties.id, id), eq(parties.version, version)),
      )
      .returning({ id: parties.id });
    return rows.length > 0;
  },

  async softDelete(
    db: Pick<Db, "update">,
    firmId: string,
    id: string,
    version: number,
  ) {
    return this.update(db, firmId, id, version, { deletedAt: new Date() });
  },

  /** Has any entry been made for this party? Then it can't be deleted or switched between customer and supplier. */
  async hasEntries(db: Pick<Db, "execute">, firmId: string, id: string) {
    const [row] = await db
      .execute<{ used: boolean }>(
        sql`
      select (
        exists (select 1 from ${vouchers} where ${vouchers.firmId} = ${firmId} and ${vouchers.partyId} = ${id})
        or exists (select 1 from ${postings} where ${postings.firmId} = ${firmId} and ${postings.account} = ${"party:" + id})
        or exists (select 1 from opening_bills where firm_id = ${firmId} and party_id = ${id})
        or exists (select 1 from imported_opening_balances where firm_id = ${firmId} and target_kind = 'party' and target_id = ${id})
      ) as used`,
      )
      .then((r) => r.rows);
    return row?.used === true;
  },
};

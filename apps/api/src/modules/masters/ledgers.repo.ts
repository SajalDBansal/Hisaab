import { and, asc, eq, getTableColumns, isNull, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";

const { ledgers, vouchers, postings, invoiceSettings } = schema;

// Balance = opening balance + everything posted to this account.
const balance = sql<string>`ledgers.opening_balance + coalesce((
  select sum(postings.debit - postings.credit)
  from postings
  join vouchers on vouchers.id = postings.voucher_id
  where postings.firm_id = ledgers.firm_id
    and postings.account = 'ledger:' || ledgers.id::text
    and vouchers.status = 'posted'), 0)`;

const columns = { ...getTableColumns(ledgers), balance };
export type LedgerRecord = Omit<typeof ledgers.$inferSelect, "balance"> & {
  balance: string;
};

const live = (firmId: string) =>
  and(eq(ledgers.firmId, firmId), isNull(ledgers.deletedAt));

export const ledgersRepo = {
  async list(db: Pick<Db, "select">, firmId: string, kind?: "cash" | "bank") {
    return db
      .select(columns)
      .from(ledgers)
      .where(and(live(firmId), kind ? eq(ledgers.kind, kind) : undefined))
      .orderBy(asc(ledgers.kind), asc(sql`lower(${ledgers.name})`));
  },

  async get(db: Pick<Db, "select">, firmId: string, id: string) {
    const [row] = await db
      .select(columns)
      .from(ledgers)
      .where(and(live(firmId), eq(ledgers.id, id)));
    return row;
  },

  async nameTaken(
    db: Pick<Db, "select">,
    firmId: string,
    name: string,
    exceptId?: string,
  ) {
    const rows = await db
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(
        and(
          live(firmId),
          sql`lower(${ledgers.name}) = lower(${name})`,
          exceptId ? ne(ledgers.id, exceptId) : undefined,
        ),
      );
    return rows.length > 0;
  },

  async insert(db: Pick<Db, "insert">, row: typeof ledgers.$inferInsert) {
    await db.insert(ledgers).values(row);
  },

  async update(
    db: Pick<Db, "update">,
    firmId: string,
    id: string,
    version: number,
    patch: Partial<typeof ledgers.$inferInsert>,
  ) {
    const rows = await db
      .update(ledgers)
      .set({ ...patch, version: sql`${ledgers.version} + 1` })
      .where(
        and(live(firmId), eq(ledgers.id, id), eq(ledgers.version, version)),
      )
      .returning({ id: ledgers.id });
    return rows.length > 0;
  },

  /** Money has moved through it, or an invoice prints its bank details. */
  async usedBy(db: Pick<Db, "execute">, firmId: string, id: string) {
    const [row] = await db
      .execute<{ entries: boolean; onInvoices: boolean }>(
        sql`select
          (exists (select 1 from ${postings} where ${postings.firmId} = ${firmId} and ${postings.account} = ${"ledger:" + id})
           or exists (select 1 from ${vouchers} where ${vouchers.firmId} = ${firmId} and (${vouchers.ledgerId} = ${id} or ${vouchers.toLedgerId} = ${id}))
          ) as entries,
          exists (select 1 from ${invoiceSettings} where ${invoiceSettings.firmId} = ${firmId} and ${invoiceSettings.bankLedgerId} = ${id}) as "onInvoices"`,
      )
      .then((r) => r.rows);
    return {
      entries: row?.entries === true,
      onInvoices: row?.onInvoices === true,
    };
  },
};

import { parseRupees, type VoucherType } from "@repo/core";
import type { SearchHit } from "@repo/contracts";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";

const { parties, items, vouchers, ledgers } = schema;
const LIMIT = 8;

const partyBalance = sql<string>`parties.opening_balance + coalesce((
  select sum(postings.debit - postings.credit)
  from postings
  join vouchers on vouchers.id = postings.voucher_id
  where postings.firm_id = parties.firm_id
    and postings.account = 'party:' || parties.id::text
    and vouchers.status = 'posted'), 0)`;

const itemStock = sql<string>`items.opening_stock + coalesce((
  select sum(stock_movements.qty)
  from stock_movements
  join vouchers on vouchers.id = stock_movements.voucher_id
  where stock_movements.firm_id = items.firm_id
    and stock_movements.item_id = items.id
    and vouchers.status = 'posted'), 0)`;

function term(query: string) {
  return `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

function canSearch(query: string) {
  return query.trim().length >= 2;
}

export const searchRepo = {
  async parties(
    db: Db,
    firmId: string,
    query: string,
    type?: "customer" | "supplier",
  ): Promise<SearchHit[]> {
    if (!canSearch(query)) return [];
    const like = term(query);
    const rows = await db
      .select({
        id: parties.id,
        title: parties.name,
        type: parties.type,
        city: parties.city,
        amount: partyBalance,
      })
      .from(parties)
      .where(
        and(
          eq(parties.firmId, firmId),
          isNull(parties.deletedAt),
          type ? eq(parties.type, type) : undefined,
          or(
            sql`lower(${parties.name}) like lower(${like})`,
            sql`${parties.phone} like ${like}`,
            sql`${parties.gstin} ilike ${like}`,
            sql`${parties.city} ilike ${like}`,
          ),
        ),
      )
      .orderBy(
        sql`similarity(lower(${parties.name}), lower(${query})) desc`,
        asc(parties.id),
      )
      .limit(LIMIT);
    return rows.map((row) => ({
      kind: "party",
      id: row.id,
      title: row.title,
      subtitle: `${row.type === "customer" ? "Customer" : "Supplier"} - ${row.city}`,
      amount: Number(row.amount),
    }));
  },

  async items(db: Db, firmId: string, query: string): Promise<SearchHit[]> {
    if (!canSearch(query)) return [];
    const like = term(query);
    const rows = await db
      .select({
        id: items.id,
        title: items.name,
        code: items.code,
        unit: items.unit,
        amount: items.salePrice,
        stock: itemStock,
      })
      .from(items)
      .where(
        and(
          eq(items.firmId, firmId),
          isNull(items.deletedAt),
          or(
            sql`lower(${items.name}) like lower(${like})`,
            sql`${items.code} ilike ${like}`,
            sql`${items.hsn} ilike ${like}`,
          ),
        ),
      )
      .orderBy(
        sql`similarity(lower(${items.name}), lower(${query})) desc`,
        asc(items.id),
      )
      .limit(LIMIT);
    return rows.map((row) => ({
      kind: "item",
      id: row.id,
      title: row.title,
      subtitle: `${row.code ? `${row.code} - ` : ""}${Number(row.stock)} ${row.unit} in stock`,
      amount: row.amount,
    }));
  },

  async vouchers(
    db: Db,
    firmId: string,
    query: string,
    types: VoucherType[],
  ): Promise<SearchHit[]> {
    if (!canSearch(query) || !types.length) return [];
    const like = term(query);
    const amount = /^[\d,.]+$/.test(query.trim())
      ? parseRupees(query.trim())
      : null;
    const rows = await db
      .select({
        id: vouchers.id,
        number: vouchers.number,
        partyName: parties.name,
        expenseHead: vouchers.expenseHead,
        reference: vouchers.reference,
        amount: vouchers.amount,
        type: vouchers.type,
        date: vouchers.date,
        status: vouchers.status,
      })
      .from(vouchers)
      .leftJoin(parties, eq(parties.id, vouchers.partyId))
      .where(
        and(
          eq(vouchers.firmId, firmId),
          inArray(vouchers.type, types),
          or(
            sql`${vouchers.number} ilike ${like}`,
            sql`${vouchers.reference} ilike ${like}`,
            sql`${vouchers.narration} ilike ${like}`,
            sql`${vouchers.expenseHead} ilike ${like}`,
            sql`${parties.name} ilike ${like}`,
            amount !== null && Number.isSafeInteger(amount) && amount > 0
              ? eq(vouchers.amount, amount)
              : undefined,
          ),
        ),
      )
      .orderBy(sql`${vouchers.date} desc`, sql`${vouchers.id} desc`)
      .limit(LIMIT);
    return rows.map((row) => ({
      kind: "voucher",
      id: row.id,
      title: [row.number, row.partyName ?? row.expenseHead]
        .filter(Boolean)
        .join(" - "),
      subtitle: row.reference ?? "",
      amount: row.amount,
      voucherType: row.type,
      date: row.date,
      cancelled: row.status === "cancelled",
    }));
  },

  async ledgers(db: Db, firmId: string, query: string): Promise<SearchHit[]> {
    if (!canSearch(query)) return [];
    const like = term(query);
    const rows = await db
      .select({
        id: ledgers.id,
        title: ledgers.name,
        shortName: ledgers.shortName,
        kind: ledgers.kind,
      })
      .from(ledgers)
      .where(
        and(
          eq(ledgers.firmId, firmId),
          isNull(ledgers.deletedAt),
          or(
            sql`${ledgers.name} ilike ${like}`,
            sql`${ledgers.shortName} ilike ${like}`,
          ),
        ),
      )
      .orderBy(asc(ledgers.name), asc(ledgers.id))
      .limit(LIMIT);
    return rows.map((row) => ({
      kind: "ledger",
      id: row.id,
      title: row.title,
      subtitle: row.kind === "cash" ? "Cash book" : "Bank book",
    }));
  },
};

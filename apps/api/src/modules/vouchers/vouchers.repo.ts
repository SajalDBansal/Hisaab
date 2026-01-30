import type { Voucher as CoreVoucher } from "@repo/core";
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import type { DateIdCursor } from "@repo/backend/modules/masters/shared";
import { hydrateVouchers } from "@repo/backend/modules/vouchers/snapshot";

const { vouchers, parties } = schema;

export interface Found {
  voucher: CoreVoucher;
  version: number;
}

async function hydrate(db: Db, rows: (typeof vouchers.$inferSelect)[]) {
  const loaded = await hydrateVouchers(db, rows);
  return loaded.map((voucher, i): Found => ({
    voucher,
    version: rows[i]?.version ?? 1,
  }));
}

export const vouchersRepo = {
  async get(db: Db, firmId: string, id: string) {
    const rows = await db
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.firmId, firmId), eq(vouchers.id, id)));
    return (await hydrate(db, rows))[0];
  },

  async list(
    db: Db,
    firmId: string,
    f: {
      type?: CoreVoucher["type"];
      types?: CoreVoucher["type"][];
      partyId?: string;
      from?: string;
      to?: string;
      status?: CoreVoucher["status"];
      search?: string;
      limit: number;
      cursor?: DateIdCursor;
    },
  ) {
    const search = f.search?.trim();
    const like = `%${search}%`;
    const rows = await db
      .select({ id: vouchers.id })
      .from(vouchers)
      .leftJoin(parties, eq(parties.id, vouchers.partyId))
      .where(
        and(
          eq(vouchers.firmId, firmId),
          f.type ? eq(vouchers.type, f.type) : undefined,
          f.types?.length ? inArray(vouchers.type, f.types) : undefined,
          f.partyId ? eq(vouchers.partyId, f.partyId) : undefined,
          f.status ? eq(vouchers.status, f.status) : undefined,
          f.from ? gte(vouchers.date, f.from) : undefined,
          f.to ? lte(vouchers.date, f.to) : undefined,
          f.cursor
            ? or(
                lt(vouchers.date, f.cursor.date),
                and(
                  eq(vouchers.date, f.cursor.date),
                  lt(vouchers.id, f.cursor.id),
                ),
              )
            : undefined,
          search
            ? or(
                sql`${vouchers.number} ilike ${like}`,
                sql`${vouchers.narration} ilike ${like}`,
                sql`${vouchers.reference} ilike ${like}`,
                sql`${vouchers.supplierInvoiceNo} ilike ${like}`,
                sql`${parties.name} ilike ${like}`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(vouchers.date), desc(vouchers.id))
      .limit(f.limit + 1);
    if (!rows.length) return [];
    const full = await db
      .select()
      .from(vouchers)
      .where(
        inArray(
          vouchers.id,
          rows.map((r) => r.id),
        ),
      );
    // Keep the order of the page
    const byId = new Map(full.map((r) => [r.id, r]));
    const ordered = rows.flatMap((r) => byId.get(r.id) ?? []);
    return hydrate(db, ordered);
  },
};

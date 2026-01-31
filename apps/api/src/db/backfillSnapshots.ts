import { captureVoucherSnapshot } from "@repo/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { schema, type Db } from "@repo/backend/db/client";

/** Older documents can only preserve the master details available at migration time. */
export async function backfillVoucherSnapshots(db: Db): Promise<void> {
  const firms = await db
    .selectDistinct({ id: schema.vouchers.firmId })
    .from(schema.vouchers)
    .where(isNull(schema.vouchers.snapshot));
  for (const firm of firms) {
    await backfillFirmSnapshots(db, firm.id);
  }
}

export async function backfillFirmSnapshots(
  db: Db,
  firmId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
    );
    const books = await loadReportBooks(tx, firmId, { includeDeleted: true });
    const snapshots = new Map(
      books.vouchers.map((voucher) => [
        voucher.id,
        voucher.snapshot ??
          captureVoucherSnapshot(
            books,
            voucher.partyId,
            voucher.lines,
            "legacy",
          ),
      ]),
    );
    for (const voucher of books.vouchers) {
      if (voucher.snapshot) continue;
      const snapshot = snapshots.get(voucher.againstId ?? voucher.id);
      await tx
        .update(schema.vouchers)
        .set({ snapshot, version: sql`${schema.vouchers.version} + 1` })
        .where(
          and(
            eq(schema.vouchers.id, voucher.id),
            isNull(schema.vouchers.snapshot),
          ),
        );
    }
  });
}

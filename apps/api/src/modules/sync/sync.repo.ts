import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { VoucherType } from "@repo/core";
import { schema, type Db } from "@repo/backend/db/client";
import { loadOpeningBills } from "@repo/backend/modules/imports/imports.opening-bills";
import {
  rememberAnswer,
  replayOf,
} from "@repo/backend/modules/vouchers/idempotency";

const { changeLog } = schema;

export type ChangeRow = typeof changeLog.$inferSelect;

export const syncRepo = {
  async latestCursor(db: Db, firmId: string) {
    const [row] = await db
      .select({ seq: sql<number>`coalesce(max(${changeLog.seq}), 0)` })
      .from(changeLog)
      .where(eq(changeLog.firmId, firmId));
    return Number(row?.seq ?? 0);
  },
  async voucherType(
    db: Db,
    firmId: string,
    id: string,
  ): Promise<VoucherType | undefined> {
    const [row] = await db
      .select({ type: schema.vouchers.type })
      .from(schema.vouchers)
      .where(
        and(eq(schema.vouchers.firmId, firmId), eq(schema.vouchers.id, id)),
      );
    return row?.type;
  },

  async changes(db: Db, firmId: string, since: number, limit: number) {
    return db
      .select()
      .from(changeLog)
      .where(and(eq(changeLog.firmId, firmId), gt(changeLog.seq, since)))
      .orderBy(asc(changeLog.seq))
      .limit(limit + 1);
  },

  async party(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.parties)
      .where(and(eq(schema.parties.firmId, firmId), eq(schema.parties.id, id)));
    if (!row) return null;
    const bills = await loadOpeningBills(db, firmId, row.deletedAt ? [] : [id]);
    return { ...row, openingBills: bills.get(id) };
  },

  async item(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.firmId, firmId), eq(schema.items.id, id)));
    return row ?? null;
  },

  async ledger(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.ledgers)
      .where(and(eq(schema.ledgers.firmId, firmId), eq(schema.ledgers.id, id)));
    return row ?? null;
  },

  async document(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select()
      .from(schema.documents)
      .where(
        and(eq(schema.documents.firmId, firmId), eq(schema.documents.id, id)),
      );
    return row ?? null;
  },

  async firmProfile(db: Db, firmId: string) {
    const [row] = await db
      .select({
        name: schema.organization.name,
        profile: schema.firmProfile,
      })
      .from(schema.firmProfile)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.firmProfile.firmId),
      )
      .where(eq(schema.firmProfile.firmId, firmId));
    return row ? { name: row.name, ...row.profile } : null;
  },

  async invoiceSettings(db: Db, firmId: string) {
    const [row] = await db
      .select()
      .from(schema.invoiceSettings)
      .where(eq(schema.invoiceSettings.firmId, firmId));
    return row ?? null;
  },

  async reminderSettings(db: Db, firmId: string) {
    const [row] = await db
      .select()
      .from(schema.reminderSettings)
      .where(eq(schema.reminderSettings.firmId, firmId));
    return row ?? null;
  },

  async replayMutation(db: Db, userId: string, key: string, hash: string) {
    return replayOf(db, userId, { key, hash });
  },

  async rememberMutation(
    db: Db,
    userId: string,
    key: string,
    requestHash: string,
    response: unknown,
  ) {
    // pushOne passes its transaction connection, so the mutation and answer commit together.
    await rememberAnswer(db, userId, { key, hash: requestHash }, 200, response);
  },
};

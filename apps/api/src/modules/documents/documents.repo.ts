import {
  and,
  desc,
  eq,
  isNull,
  isNotNull,
  inArray,
  gte,
  lte,
  ilike,
  or,
  sql,
  asc,
  gt,
  ne,
} from "drizzle-orm";
import { can, type DocumentFilters, type Role } from "@repo/core";
import { schema, type Db } from "@repo/backend/db/client";
import { canReadBooks, readableVoucherTypes } from "../../lib/read-permissions";
import { THUMBNAIL_MAX_BYTES } from "../../lib/storage";

const { documents, parties, vouchers, postings } = schema;

const live = (firmId: string) =>
  and(eq(documents.firmId, firmId), isNull(documents.deletedAt));

// Voucher restrictions take precedence over a secondary party link.
export function readableDocument(firmId: string, role: Role) {
  if (canReadBooks(role)) return undefined;
  if (!can(role, "sales")) return sql`false`;
  const customer = sql`exists (select 1 from ${parties}
    where ${parties.id} = ${documents.partyId} and ${parties.firmId} = ${firmId}
    and ${parties.type} = 'customer')`;
  const voucher = sql`exists (select 1 from ${vouchers}
    where ${vouchers.id} = ${documents.voucherId} and ${vouchers.firmId} = ${firmId}
    and ${inArray(vouchers.type, readableVoucherTypes(role))})`;
  return and(
    isNull(documents.accountKey),
    or(isNull(documents.partyId), customer),
    or(voucher, and(isNull(documents.voucherId), customer)),
  );
}

export const documentsRepo = {
  async canRead(db: Db, firmId: string, id: string, role: Role) {
    // Sync must authorize deleted rows too so permitted clients receive their tombstones.
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.firmId, firmId),
          eq(documents.id, id),
          readableDocument(firmId, role),
        ),
      );
    return !!row;
  },

  async list(
    db: Db,
    firmId: string,
    role: Role,
    filters: DocumentFilters = {},
  ) {
    const date =
      filters.dateBy === "entry"
        ? sql`coalesce(${vouchers.date}, ${documents.uploadedOn})`
        : sql`${documents.uploadedOn}`;
    const postingMatches = (
      keys: string[],
    ) => sql`exists (select 1 from ${postings}
      where ${postings.firmId} = ${firmId} and ${postings.voucherId} = ${documents.voucherId}
      and ${inArray(postings.account, keys)})`;
    return db
      .select({
        document: documents,
        partyName: parties.name,
        voucherNumber: vouchers.number,
        entryDate: vouchers.date,
      })
      .from(documents)
      .leftJoin(
        vouchers,
        and(eq(vouchers.id, documents.voucherId), eq(vouchers.firmId, firmId)),
      )
      .leftJoin(
        parties,
        and(eq(parties.id, documents.partyId), eq(parties.firmId, firmId)),
      )
      .where(
        and(
          live(firmId),
          readableDocument(firmId, role),
          isNotNull(documents.readyAt),
          filters.kinds?.length
            ? inArray(documents.kind, filters.kinds)
            : undefined,
          filters.partyIds?.length
            ? or(
                inArray(documents.partyId, filters.partyIds),
                inArray(
                  documents.accountKey,
                  filters.partyIds.map((id) => `party:${id}`),
                ),
                postingMatches(filters.partyIds.map((id) => `party:${id}`)),
              )
            : undefined,
          filters.accountKeys?.length
            ? or(
                inArray(documents.accountKey, filters.accountKeys),
                postingMatches(filters.accountKeys),
              )
            : undefined,
          filters.voucherId
            ? eq(documents.voucherId, filters.voucherId)
            : undefined,
          filters.from ? gte(date, filters.from) : undefined,
          filters.to ? lte(date, filters.to) : undefined,
          filters.folder !== undefined
            ? eq(documents.folder, filters.folder)
            : undefined,
          filters.search
            ? ilike(
                documents.name,
                `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(documents.uploadedOn), desc(documents.id));
  },

  async folders(db: Db, firmId: string, role: Role) {
    const rows = await db
      .selectDistinct({ folder: documents.folder })
      .from(documents)
      .where(
        and(
          live(firmId),
          readableDocument(firmId, role),
          isNotNull(documents.readyAt),
        ),
      );
    return rows
      .map((row) => row.folder)
      .filter(Boolean)
      .sort();
  },

  async update(
    db: Db,
    firmId: string,
    id: string,
    patch: Partial<typeof documents.$inferInsert>,
    keepPendingReservation = false,
  ) {
    const [row] = await db
      .update(documents)
      .set({
        ...patch,
        updatedAt: keepPendingReservation
          ? sql`case when ${documents.readyAt} is null then ${documents.updatedAt} else now() end`
          : new Date(),
      })
      .where(and(live(firmId), eq(documents.id, id)))
      .returning();
    return row;
  },

  async get(
    db: Db,
    firmId: string,
    id: string,
    role?: Role,
    includeDeleted = false,
  ) {
    const [row] = await db
      .select()
      .from(documents)
      .where(
        and(
          includeDeleted ? eq(documents.firmId, firmId) : live(firmId),
          eq(documents.id, id),
          role ? readableDocument(firmId, role) : undefined,
        ),
      );
    return row;
  },

  async insert(db: Db, row: typeof documents.$inferInsert) {
    await db.insert(documents).values(row);
  },

  async usage(db: Db, firmId: string, excludeId?: string) {
    const [row] = await db
      .select({
        bytes: sql<string>`coalesce(sum(${documents.sizeBytes} + case when ${documents.contentType} like 'image/%' then ${THUMBNAIL_MAX_BYTES} else 0 end), 0)`,
        files: sql<string>`count(*)`,
      })
      .from(documents)
      .where(
        and(
          live(firmId),
          excludeId ? ne(documents.id, excludeId) : undefined,
          or(
            isNotNull(documents.readyAt),
            and(
              isNotNull(documents.s3Key),
              sql`${documents.updatedAt} >= clock_timestamp() - interval '24 hours'`,
            ),
          ),
        ),
      );
    return { bytes: Number(row?.bytes ?? 0), files: Number(row?.files ?? 0) };
  },

  async missingThumbnails(
    db: Db,
    firmId: string,
    limit: number,
    afterId?: string,
  ) {
    return db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          live(firmId),
          isNotNull(documents.readyAt),
          isNull(documents.thumbnailKey),
          isNotNull(documents.s3Key),
          inArray(documents.contentType, [
            "image/jpeg",
            "image/png",
            "image/heic",
            "image/heif",
          ]),
          afterId ? gt(documents.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(documents.id))
      .limit(limit);
  },

  async softDelete(db: Db, firmId: string, id: string, deletedAt = new Date()) {
    const rows = await db
      .update(documents)
      .set({ deletedAt })
      .where(and(live(firmId), eq(documents.id, id)))
      .returning({ id: documents.id });
    return rows.length > 0;
  },

  async partyExists(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.firmId, firmId),
          eq(parties.id, id),
          isNull(parties.deletedAt),
        ),
      );
    return !!row;
  },

  async voucherExists(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select({
        id: vouchers.id,
        partyId: vouchers.partyId,
        type: vouchers.type,
      })
      .from(vouchers)
      .where(and(eq(vouchers.firmId, firmId), eq(vouchers.id, id)));
    return row;
  },
};

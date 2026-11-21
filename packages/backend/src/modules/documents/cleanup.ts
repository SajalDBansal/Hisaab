import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PoolClient } from "pg";
import { schema, type Db } from "../../db/client";
import { AppError } from "../../lib/app-error";
import type { DocumentCleanupStorage } from "./cleanup-storage";

const { documentCleanup, documents } = schema;
const LEASE_MS = 15 * 60 * 1000;
type CleanupRow = typeof documentCleanup.$inferSelect;
type CleanupInput = Pick<
  CleanupRow,
  "documentId" | "firmId" | "objectKey" | "thumbnailKey" | "deletedAt"
>;

// Call inside the transaction that marks the document deleted; never enqueue only in Redis.
export async function scheduleDocumentCleanup(db: Db, input: CleanupInput) {
  await db
    .insert(documentCleanup)
    .values({
      ...input,
      // Let outstanding five-minute upload tickets expire before removing staging objects.
      nextAttemptAt: new Date(input.deletedAt.getTime() + LEASE_MS),
    })
    .onConflictDoNothing();
}

// The caller must use the same exported PostgreSQL snapshot as pg_dump.
export async function listSnapshotCleanupIds(
  client: Pick<PoolClient, "query">,
) {
  const result = await client.query<{ document_id: string }>(
    `select c.document_id from document_cleanup c
     join documents d on d.id = c.document_id and d.firm_id = c.firm_id
     where d.deleted_at is not null and d.s3_key = c.object_key
       and c.backup_safe_at is null and c.completed_at is null
     order by c.document_id`,
  );
  return result.rows.map((row) => row.document_id);
}

// Publish and verify latest.json first. A failed publication must not release any objects.
export async function markDocumentCleanupBackupSafe(
  db: Db,
  ids: string[],
  backupId: string,
) {
  if (!backupId || backupId.length > 200)
    throw new Error("A verified backup ID is required.");
  for (let offset = 0; offset < ids.length; offset += 500) {
    await db
      .update(documentCleanup)
      .set({ backupSafeAt: new Date(), backupId })
      .where(
        and(
          inArray(documentCleanup.documentId, ids.slice(offset, offset + 500)),
          isNull(documentCleanup.backupSafeAt),
          isNull(documentCleanup.completedAt),
        ),
      );
  }
}

async function claimCleanup(db: Db) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({ cleanup: documentCleanup })
      .from(documentCleanup)
      .innerJoin(
        documents,
        and(
          eq(documents.id, documentCleanup.documentId),
          eq(documents.firmId, documentCleanup.firmId),
        ),
      )
      .where(
        and(
          isNull(documentCleanup.completedAt),
          isNotNull(documentCleanup.backupSafeAt),
          isNotNull(documents.deletedAt),
          eq(documents.s3Key, documentCleanup.objectKey),
          lte(documentCleanup.nextAttemptAt, now),
          or(
            isNull(documentCleanup.leaseUntil),
            lte(documentCleanup.leaseUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(documentCleanup.nextAttemptAt),
        asc(documentCleanup.documentId),
      )
      .limit(1)
      .for("update", { of: documentCleanup, skipLocked: true });
    if (!row) return undefined;
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(documentCleanup)
      .set({
        attempts: sql`${documentCleanup.attempts} + 1`,
        leaseToken,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(documentCleanup.documentId, row.cleanup.documentId))
      .returning();
    return claimed ? { ...claimed, leaseToken } : undefined;
  });
}

function objectKeys(row: CleanupRow) {
  const prefix = `firms/${row.firmId}/documents/${row.documentId}`;
  const extension = row.objectKey.slice(prefix.length);
  if (
    !row.objectKey.startsWith(prefix) ||
    !/^\.(pdf|jpg|jpeg|png|heic|heif)$/.test(extension) ||
    (row.thumbnailKey && row.thumbnailKey !== `${row.objectKey}.thumb.jpg`)
  )
    throw new AppError(
      "INVALID_DOCUMENT_KEY",
      "Document cleanup keys do not match their firm and document.",
    );
  return [
    `${row.objectKey}.thumb.jpg`,
    row.objectKey,
    `pending/${row.objectKey}`,
  ];
}

// Persist a lease before network I/O so restarts and another worker can safely retry.
export async function runDocumentCleanup(
  db: Db,
  storage: DocumentCleanupStorage,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 25)));
  let completed = 0;
  let failed = 0;
  for (let i = 0; i < limit && !options.signal?.aborted; i++) {
    const row = await claimCleanup(db);
    if (!row) break;
    const ownLease = and(
      eq(documentCleanup.documentId, row.documentId),
      eq(documentCleanup.leaseToken, row.leaseToken),
    );
    try {
      for (const key of objectKeys(row))
        await storage.removeObject(key, options.signal);
      await db
        .update(documentCleanup)
        .set({
          completedAt: new Date(),
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: null,
        })
        .where(ownLease);
      completed++;
    } catch (error) {
      // Store only a controlled category; provider messages may contain credentials or object data.
      const code =
        error instanceof AppError && error.code === "INVALID_DOCUMENT_KEY"
          ? "INVALID_DOCUMENT_KEY"
          : "OBJECT_DELETE_FAILED";
      const retryMs = Math.min(
        60 * 60 * 1000,
        60_000 * 2 ** Math.min(row.attempts - 1, 6),
      );
      await db
        .update(documentCleanup)
        .set({
          leaseUntil: null,
          leaseToken: null,
          lastErrorCode: code,
          nextAttemptAt: new Date(Date.now() + retryMs),
        })
        .where(ownLease);
      failed++;
    }
  }
  return { completed, failed };
}

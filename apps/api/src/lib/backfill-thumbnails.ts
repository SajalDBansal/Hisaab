import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { documentsRepo } from "../modules/documents/documents.repo";
import { lockDocumentFirm } from "../modules/documents/documents.quota";
import { AppError } from "@repo/backend/lib/app-error";
import type { FileStorage } from "./storage";

const Batch = z.object({
  firmId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(25),
  afterId: z.uuid().optional(),
});

async function backfillOne(
  db: Db,
  storage: FileStorage,
  firmId: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    await lockDocumentFirm(tx, firmId, id);
    const connection = tx as unknown as Db;
    const row = await documentsRepo.get(connection, firmId, id);
    if (
      !row?.readyAt ||
      row.thumbnailKey ||
      !row.s3Key ||
      !row.contentType?.startsWith("image/")
    )
      return false;
    if (!row.s3Key.startsWith(`firms/${firmId}/documents/`))
      throw new AppError(
        "INVALID_DOCUMENT_KEY",
        "The saved file is outside this firm's document folder.",
        409,
      );
    const preview = await storage.createThumbnail(row.s3Key);
    await documentsRepo.update(connection, firmId, id, preview);
    return true;
  });
}

// Explicitly invoked per firm; never scan a bucket or replace the saved full image.
export async function backfillDocumentThumbnails(
  db: Db,
  storage: FileStorage,
  input: z.input<typeof Batch>,
) {
  const { firmId, limit, afterId } = Batch.parse(input);
  const rows = await documentsRepo.missingThumbnails(
    db,
    firmId,
    limit,
    afterId,
  );
  const result = {
    scanned: rows.length,
    created: 0,
    skipped: 0,
    failures: [] as { id: string; code: string }[],
    nextCursor: rows.length === limit ? rows.at(-1)?.id : undefined,
  };
  for (const row of rows) {
    try {
      if (await backfillOne(db, storage, firmId, row.id)) result.created += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failures.push({
        id: row.id,
        code: error instanceof AppError ? error.code : "THUMBNAIL_FAILED",
      });
    }
  }
  return result;
}

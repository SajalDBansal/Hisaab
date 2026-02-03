import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { THUMBNAIL_MAX_BYTES } from "../../lib/storage";
import { documentsRepo } from "./documents.repo";

export const DocumentLimits = z.object({
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(1024 ** 3),
  maxFiles: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(10_000),
});
export type DocumentLimits = z.infer<typeof DocumentLimits>;
export const DEFAULT_DOCUMENT_LIMITS = DocumentLimits.parse({});
export type DocumentOptions = { limits?: Partial<DocumentLimits> };
export type DocumentTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function lockDocumentFirm(
  tx: DocumentTx,
  firmId: string,
  id?: string,
) {
  // Serialize storage quotas without holding the financial posting lock during R2 calls.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`documents:${firmId}`}, 0))`,
  );
  if (id)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`document:${id}`}))`,
    );
}

export async function lockUploadKey(
  tx: DocumentTx,
  userId: string,
  key: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`document-upload:${userId}:${key}`}, 2))`,
  );
}

export const previewAllowance = (contentType: string | null) =>
  contentType?.startsWith("image/") ? THUMBNAIL_MAX_BYTES : 0;

export async function availableDocumentBytes(
  db: Db,
  firmId: string,
  file: { sizeBytes: number; contentType: string | null },
  limits: DocumentLimits,
  excludeId?: string,
) {
  const used = await documentsRepo.usage(db, firmId, excludeId);
  const available =
    limits.maxBytes - used.bytes - previewAllowance(file.contentType);
  if (
    !Number.isSafeInteger(used.bytes) ||
    !Number.isSafeInteger(used.files) ||
    used.files >= limits.maxFiles ||
    file.sizeBytes > available
  )
    throw new AppError(
      "DOCUMENT_QUOTA_EXCEEDED",
      "This firm's document storage limit is reached. Remove unused files or ask the owner to increase the limit.",
      409,
    );
  return available;
}

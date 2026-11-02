import { z } from "zod";

export const Counts = z
  .object({
    users: z.number().int().nonnegative(),
    firms: z.number().int().nonnegative(),
    vouchers: z.number().int().nonnegative(),
    postings: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
  })
  .strict();

export const Archive = z
  .object({
    id: z.uuid(),
    key: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    captureStartedAt: z.iso.datetime(),
    captureFinishedAt: z.iso.datetime(),
    verifiedAt: z.iso.datetime(),
    publishedAt: z.iso.datetime(),
    occurrence: z.string(),
    serverVersion: z.string(),
    clientVersion: z.string(),
    release: z.string(),
    migrationCount: z.number().int().positive(),
    migrationHash: z.string(),
    counts: Counts,
    coverage: z.literal("whole-database-v1; attachments-metadata-only"),
    verification: z.literal("download-sha256-and-archive-list"),
  })
  .strict();

export const Manifest = z
  .object({
    version: z.literal(1),
    installationId: z.string(),
    writerId: z.string(),
    revision: z.uuid(),
    archive: Archive.nullable(),
  })
  .strict();

export type Archive = z.infer<typeof Archive>;
export type Manifest = z.infer<typeof Manifest>;
export type Counts = z.infer<typeof Counts>;
export type StoredManifest = { manifest: Manifest; etag: string; lastModified?: Date };
export type PendingPublication = {
  expectedEtag: string;
  manifest: Manifest;
  cleanupIds: string[];
};

// A 02:00 India occurrence remains due until a verified snapshot covers it.
export function dueOccurrence(now = new Date()) {
  const shifted = new Date(now.getTime() + 330 * 60_000);
  if (shifted.getUTCHours() < 2) shifted.setUTCDate(shifted.getUTCDate() - 1);
  shifted.setUTCHours(2, 0, 0, 0);
  return new Date(shifted.getTime() - 330 * 60_000).toISOString();
}

export function backupDue(archive: Archive | null, now = new Date()) {
  return !archive || archive.captureStartedAt < dueOccurrence(now);
}

import { isDeepStrictEqual } from "node:util";
import {
  FIRM_EXPORT_VERSION,
  FirmExportData,
  FirmExportPayload,
  MAX_FIRM_EXPORT_BYTES,
  MAX_FIRM_EXPORT_ROWS,
  type BackupInspection,
} from "@repo/contracts";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import {
  readBackupStatus,
  readFirmExport,
  requireBackupOwner,
} from "./backup.repo";
import {
  attachmentManifest,
  exportDigest,
  readExport,
  validateExportLinks,
} from "./backup.validation";

const snapshot = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

function counts(data: FirmExportData) {
  return {
    parties: data.parties.length,
    items: data.items.length,
    vouchers: data.vouchers.length,
    documents: data.documents.length,
  };
}

export const backupService = {
  async status(db: Db, firmId: string, userId: string) {
    return db.transaction(async (tx) => {
      await requireBackupOwner(tx, firmId, userId);
      return {
        ...(await readBackupStatus(tx, firmId)),
        coverage: "books-and-attachment-metadata" as const,
        restoreAvailable: true as const,
        automaticBackupAvailable: false as const,
        maxExportBytes: MAX_FIRM_EXPORT_BYTES,
        maxExportRows: MAX_FIRM_EXPORT_ROWS,
      };
    }, snapshot);
  },

  async create(db: Db, firmId: string, userId: string) {
    const payload = await db.transaction(async (tx) => {
      await requireBackupOwner(tx, firmId, userId);
      const savedAt = new Date().toISOString();
      // Dates become ISO strings without mutating the stored records.
      const raw = JSON.parse(JSON.stringify(await readFirmExport(tx, firmId)));
      const result = FirmExportData.safeParse(raw);
      if (!result.success || !isDeepStrictEqual(raw, result.data))
        throw new AppError(
          "EXPORT_DATA_INVALID",
          "Some stored records cannot be exported safely. Ask your administrator to check the data; no partial file was created.",
          409,
        );
      const data = result.data;
      const file = FirmExportPayload.parse({
        app: "hisaab",
        kind: "firm-books-export",
        version: FIRM_EXPORT_VERSION,
        savedAt,
        sourceFirmId: firmId,
        data,
        attachments: attachmentManifest(data),
      });
      validateExportLinks(file);
      return file;
    }, snapshot);
    const text = JSON.stringify({
      payload,
      integrity: { algorithm: "sha256", digest: exportDigest(payload) },
    });
    if (Buffer.byteLength(text, "utf8") > MAX_FIRM_EXPORT_BYTES)
      throw new AppError(
        "EXPORT_TOO_LARGE",
        "The complete export exceeds 10 MiB. No partial file was created.",
        413,
      );
    const name =
      payload.data.organization.name
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 60) || "Books";
    // Creating a file is not evidence that a user saved an offsite backup.
    return {
      fileName: `Hisaab_${name}_${payload.savedAt.slice(0, 10)}.json`,
      text,
    };
  },

  async inspect(
    db: Db,
    firmId: string,
    userId: string,
    text: string,
  ): Promise<BackupInspection> {
    await requireBackupOwner(db, firmId, userId);
    const file = readExport(text);
    if (file.payload.sourceFirmId !== firmId)
      throw new AppError(
        "BACKUP_FIRM_MISMATCH",
        "Select the original firm before inspecting this export.",
        403,
      );
    return {
      firmName: file.payload.data.organization.name,
      savedAt: file.payload.savedAt,
      counts: counts(file.payload.data),
      version: FIRM_EXPORT_VERSION,
      sourceFirmId: firmId,
      digest: file.integrity.digest,
      restoreAvailable: true,
      attachments: "metadata-only",
      warnings: [
        "Restore requires a financial validation preview and explicit confirmation. It creates a new firm and never replaces existing books.",
        "Photos, documents and thumbnails are not inside this file. R2 object availability and offsite recovery have not been checked.",
        "The checksum checks file integrity only; it does not authenticate the file's author or approve its accounting figures.",
      ],
    };
  },
};

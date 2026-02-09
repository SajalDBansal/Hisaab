import { isDeepStrictEqual } from "node:util";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  BackupRestoreInput,
  BackupRestorePreview,
  BackupRestorePreviewInput,
  BackupRestoreResult,
  FIRM_EXPORT_VERSION,
  FirmExportData,
  type FirmExportFile,
} from "@repo/contracts";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { replayOf, rememberAnswer } from "@repo/backend/modules/vouchers/idempotency";
import { backupService } from "./backup.service";
import {
  checkExportSchema,
  readFirmExport,
  requireBackupOwner,
} from "./backup.repo";
import {
  attachmentManifest,
  exportDigest,
  readExport,
} from "./backup.validation";
import { checkRestoreBooks } from "./restore.checks";
import { remapBooks, unsupported } from "./restore.remap";
import { restoreRepo, type RestoreTx } from "./restore.repo";

const lifetime = 30 * 60 * 1000;
const missingAttachments = (data: FirmExportData) =>
  data.documents.filter((row) => !row.deletedAt).length;

function checkSource(file: FirmExportFile, firmId: string) {
  if (file.payload.sourceFirmId !== firmId)
    throw new AppError(
      "BACKUP_FIRM_MISMATCH",
      "Select the original firm before restoring its export.",
      403,
    );
}

async function checkName(db: Pick<Db, "select">, userId: string, name: string) {
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .innerJoin(
      schema.member,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(
      and(
        eq(schema.member.userId, userId),
        sql`lower(trim(${schema.organization.name})) = lower(${name})`,
      ),
    );
  if (rows.length)
    throw new AppError(
      "RESTORE_NAME_USED",
      "Choose a different name for the new recovered firm.",
      409,
    );
}

// Holding membership until commit prevents an in-flight restore after the owner's access is revoked.
async function lockOwner(tx: RestoreTx, firmId: string, userId: string) {
  await tx
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, firmId),
        eq(schema.member.userId, userId),
      ),
    )
    .for("share");
  await requireBackupOwner(tx, firmId, userId);
}

async function verifyWrittenBooks(
  tx: RestoreTx,
  firmId: string,
  expected: FirmExportData,
  originEventId: string,
  savedAt: string,
) {
  const actual = FirmExportData.parse(
    JSON.parse(JSON.stringify(await readFirmExport(tx, firmId))),
  );
  // Ignore row order only; every persisted field must round-trip without rounding or data loss.
  const rowKey = (row: Record<string, unknown>) =>
    String(
      row.id ??
        row.name ??
        row.account ??
        row.partyId ??
        `${row.type}:${row.series}:${row.financialYear}`,
    );
  const comparable = (data: FirmExportData) =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? [...value].sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
          : value,
      ]),
    );
  const imported = {
    ...actual,
    bookControlEvents: actual.bookControlEvents.filter(
      (row) => row.id !== originEventId,
    ),
  };
  if (!isDeepStrictEqual(comparable(imported), comparable(expected)))
    unsupported(
      "The recovered records did not round-trip exactly. No firm was created.",
    );
  // Provenance also consumes archive space; never create a firm that cannot be exported again.
  const payload = {
    app: "hisaab",
    kind: "firm-books-export",
    version: FIRM_EXPORT_VERSION,
    savedAt,
    sourceFirmId: firmId,
    data: actual,
    attachments: attachmentManifest(actual),
  };
  readExport(
    JSON.stringify({
      payload,
      integrity: { algorithm: "sha256", digest: exportDigest(payload) },
    }),
  );
}

export const restoreService = {
  async preview(
    db: Db,
    firmId: string,
    userId: string,
    raw: BackupRestorePreviewInput,
  ) {
    const input = BackupRestorePreviewInput.parse(raw);
    const inspection = await backupService.inspect(
      db,
      firmId,
      userId,
      input.text,
    );
    const file = readExport(input.text);
    checkRestoreBooks(file.payload.data);
    return db.transaction(async (tx) => {
      await lockOwner(tx, firmId, userId);
      await checkExportSchema(tx);
      await checkName(tx, userId, input.name);
      const preview = BackupRestorePreview.parse({
        ...inspection,
        previewId: uuidv7(),
        newFirmName: input.name,
        expiresAt: new Date(Date.now() + lifetime).toISOString(),
        missingAttachments: missingAttachments(file.payload.data),
      });
      await rememberAnswer(
        tx,
        userId,
        { key: `backup-preview:${preview.previewId}`, hash: preview.digest },
        202,
        preview,
      );
      return preview;
    });
  },

  async restore(
    db: Db,
    firmId: string,
    userId: string,
    raw: BackupRestoreInput,
  ): Promise<BackupRestoreResult> {
    const input = BackupRestoreInput.parse(raw);
    await requireBackupOwner(db, firmId, userId);
    const file = readExport(input.text);
    checkSource(file, firmId);
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '30s'`);
      await tx.execute(sql`set local lock_timeout = '10s'`);
      // Serialize confirmations per owner, including concurrent retries from two devices.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`backup-restore:${userId}`}, 0))`,
      );
      await lockOwner(tx, firmId, userId);
      const request = {
        key: `backup-restore:${input.previewId}`,
        hash: file.integrity.digest,
      };
      const completed = await replayOf<BackupRestoreResult>(
        tx,
        userId,
        request,
      );
      if (completed) {
        const result = BackupRestoreResult.parse(completed);
        await requireBackupOwner(tx, result.firmId, userId);
        return result;
      }
      const stored = await replayOf<BackupRestorePreview>(tx, userId, {
        key: `backup-preview:${input.previewId}`,
        hash: file.integrity.digest,
      });
      const preview = stored ? BackupRestorePreview.parse(stored) : undefined;
      if (
        !preview ||
        preview.sourceFirmId !== firmId ||
        Date.parse(preview.expiresAt) <= Date.now()
      )
        throw new AppError(
          "RESTORE_PREVIEW_EXPIRED",
          "Inspect the file again to get a new restore preview.",
          409,
        );
      await checkExportSchema(tx);
      await checkName(tx, userId, preview.newFirmName);
      checkRestoreBooks(file.payload.data);
      const mapped = remapBooks(file.payload.data, preview.newFirmName);
      const restoredAt = new Date().toISOString();
      mapped.data.organization.createdAt = restoredAt;
      FirmExportData.parse(mapped.data);
      checkRestoreBooks(mapped.data);
      await restoreRepo.insertBooks(tx, mapped, userId);
      const originEventId = await restoreRepo.recordOrigin(
        tx,
        mapped,
        file,
        input.previewId,
        userId,
        restoredAt,
      );
      await verifyWrittenBooks(
        tx,
        mapped.firmId,
        mapped.data,
        originEventId,
        restoredAt,
      );
      const result = BackupRestoreResult.parse({
        firmId: mapped.firmId,
        firmName: preview.newFirmName,
        sourceFirmId: firmId,
        savedAt: file.payload.savedAt,
        restoredAt,
        counts: preview.counts,
        missingAttachments: missingAttachments(mapped.data),
        remindersEnabled: false,
        originEventId,
      });
      await rememberAnswer(tx, userId, request, 201, result);
      return result;
    });
  },

  async recovery(db: Db, firmId: string, userId: string) {
    await requireBackupOwner(db, firmId, userId);
    const [origin] = await db
      .select()
      .from(schema.bookControlEvents)
      .where(
        and(
          eq(schema.bookControlEvents.firmId, firmId),
          eq(schema.bookControlEvents.action, "restore-origin"),
        ),
      )
      .orderBy(desc(schema.bookControlEvents.id))
      .limit(1);
    if (!origin)
      return { sourceFirmId: null, restoredAt: null, missingAttachments: 0 };
    const [total] = await db
      .select({ value: count() })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.firmId, firmId),
          isNull(schema.documents.deletedAt),
          isNull(schema.documents.readyAt),
          // New upload reservations have keys; only detached recovery placeholders are missing.
          isNull(schema.documents.s3Key),
        ),
      );
    const before = origin.before as { sourceFirmId: string };
    return {
      sourceFirmId: before.sourceFirmId,
      restoredAt: origin.at.toISOString(),
      missingAttachments: total?.value ?? 0,
    };
  },
};

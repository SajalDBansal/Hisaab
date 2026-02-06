import { sql } from "drizzle-orm";
import {
  ImportApplyInput,
  ImportApplyResult,
  ImportPreviewInput,
  ImportRequestHeaders,
  MAX_IMPORT_ERRORS,
  isFinancialImport,
  type ImportApplyResponse,
  type ImportKind,
  type ImportPreview,
} from "@repo/contracts/src/imports";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { isUniqueViolation } from "@repo/backend/modules/masters/shared";
import {
  importErrorsCsv,
  importTemplate,
  readImportCsv,
  type CsvParser,
} from "./imports.csv";
import {
  authorizeImport,
  importContext,
  importReceipt,
  insertImportedMasters,
  saveImportReceipt,
} from "./imports.repo";
import { importHash, importTokens } from "./imports.token";
import { validateImport } from "./imports.validation";
import {
  financialImportContext,
  insertFinancialImport,
} from "./imports.financial.repo";
import { validateFinancialImport } from "./imports.financial.validation";

export function createImportService(options: {
  parseCsv: CsvParser;
  previewSecret: string;
}) {
  if (typeof options.parseCsv !== "function")
    throw new Error("Master imports require the configured CSV parser.");
  const tokens = importTokens(options.previewSecret);
  return {
    template: (kind: ImportKind) => importTemplate(kind),
    async preview(
      db: Db,
      firmId: string,
      userId: string,
      request: ImportPreviewInput,
    ): Promise<ImportPreview> {
      const input = ImportPreviewInput.parse(request);
      const csv = readImportCsv(input.text, options.parseCsv);
      return withFirmWrite(db, firmId, async (tx) => {
        await authorizeImport(
          tx,
          firmId,
          userId,
          isFinancialImport(input.kind),
        );
        if (isFinancialImport(input.kind)) {
          const context = await financialImportContext(tx, firmId, csv);
          const { preview } = validateFinancialImport(input.kind, csv, context);
          if (preview.canApply) {
            const signed = tokens.issue({
              firmId,
              userId,
              kind: input.kind,
              hash: importHash(input.text),
              digest: importHash(JSON.stringify(context)),
            });
            preview.previewToken = signed.token;
            preview.expiresAt = signed.expiresAt;
          }
          return preview;
        }
        const context = await importContext(tx, firmId, input.kind, csv);
        const { preview } = validateImport(input.kind, csv, context);
        if (preview.canApply) {
          const signed = tokens.issue({
            firmId,
            userId,
            kind: input.kind,
            hash: importHash(input.text),
          });
          preview.previewToken = signed.token;
          preview.expiresAt = signed.expiresAt;
        }
        return preview;
      });
    },
    async apply(
      db: Db,
      firmId: string,
      userId: string,
      request: ImportApplyInput,
      requestKey: string,
    ): Promise<ImportApplyResponse> {
      const input = ImportApplyInput.parse(request);
      ImportRequestHeaders.parse({ "idempotency-key": requestKey });
      const fileHash = importHash(input.text);
      const claims = tokens.verify(input.previewToken, {
        firmId,
        userId,
        kind: input.kind,
        hash: fileHash,
      });
      try {
        return await withFirmWrite(db, firmId, async (tx) => {
          await authorizeImport(
            tx,
            firmId,
            userId,
            isFinancialImport(input.kind),
          );
          // This user/key lock also serializes accidental key reuse in different firms.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`master-import:${userId}:${requestKey}`}, 0))`,
          );
          const receipts = await importReceipt(
            tx,
            userId,
            requestKey,
            claims.id,
          );
          for (const receipt of receipts) {
            if (
              receipt.id !== claims.id ||
              receipt.firmId !== firmId ||
              receipt.userId !== userId ||
              receipt.fileHash !== fileHash ||
              receipt.kind !== input.kind
            )
              throw new AppError(
                "KEY_REUSED",
                "This import request key belongs to another import. Preview again.",
                409,
              );
          }
          if (receipts[0])
            return {
              status: "applied",
              result: ImportApplyResult.parse(receipts[0].result),
            };
          if (claims.expires <= Date.now())
            throw new AppError(
              "IMPORT_PREVIEW_EXPIRED",
              "This preview expired. Preview the CSV again.",
              422,
            );
          // Ignore client row counts and values. Parse and revalidate the exact signed file under the firm lock.
          const csv = readImportCsv(input.text, options.parseCsv);
          if (isFinancialImport(input.kind)) {
            const context = await financialImportContext(tx, firmId, csv);
            const { preview, prepared } = validateFinancialImport(
              input.kind,
              csv,
              context,
            );
            if (claims.digest !== importHash(JSON.stringify(context))) {
              preview.canApply = false;
              preview.validRows = 0;
              preview.errors.unshift({
                row: 1,
                field: "books",
                code: "invalid",
                message:
                  "Opening books changed after preview. Preview again and review all totals.",
              });
              if (preview.errors.length > MAX_IMPORT_ERRORS) {
                preview.errors.pop();
                preview.errorsTruncated = true;
              }
              preview.errorsCsv = importErrorsCsv(
                preview.errors,
                preview.errorsTruncated,
              );
              if (preview.reconciliation)
                preview.reconciliation.reconciled = false;
            }
            if (!preview.canApply) return { status: "invalid", preview };
            const inserted = await insertFinancialImport(
              tx,
              firmId,
              userId,
              claims.id,
              prepared,
              context,
            );
            const result = ImportApplyResult.parse({
              batchId: claims.id,
              kind: input.kind,
              createdCount: inserted.createdIds.length,
              ...inserted,
              appliedAt: new Date().toISOString(),
              reconciliation: preview.reconciliation,
            });
            await saveImportReceipt(tx, {
              firmId,
              userId,
              requestKey,
              fileHash,
              result,
            });
            return { status: "applied", result };
          }
          const context = await importContext(tx, firmId, input.kind, csv);
          const { preview, prepared } = validateImport(
            input.kind,
            csv,
            context,
          );
          if (!preview.canApply) return { status: "invalid", preview };
          const createdIds = await insertImportedMasters(
            tx,
            firmId,
            prepared,
            context,
          );
          const result = ImportApplyResult.parse({
            batchId: claims.id,
            kind: input.kind,
            createdCount: createdIds.length,
            createdIds,
            appliedAt: new Date().toISOString(),
          });
          await saveImportReceipt(tx, {
            firmId,
            userId,
            requestKey,
            fileHash,
            result,
          });
          return { status: "applied", result };
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new AppError(
            "IMPORT_CONFLICT",
            "A matching record was saved while this import was being confirmed. Nothing from this request was imported; preview again.",
            409,
          );
        throw error;
      }
    },
  };
}

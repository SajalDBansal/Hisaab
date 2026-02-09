import {
  BackupExportResponse,
  BackupInspection,
  BackupInspectInput,
  BackupStatusView,
  BackupRestorePreviewInput,
  BackupRestorePreview,
  BackupRestoreInput,
  BackupRestoreResult,
  BackupRecoveryStatus,
  MAX_FIRM_EXPORT_BYTES,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { backupService } from "./backup.service";
import { restoreService } from "./restore.service";

export async function backupRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const owner = [
    ...app.inFirm(),
    async (req: Parameters<typeof app.authenticate>[0]) => {
      if (req.firm.role !== "owner")
        throw new AppError(
          "FORBIDDEN",
          "Only the firm owner can export, inspect or recover its books.",
          403,
        );
    },
  ];
  // Mark private payloads before the global onSend hook can generate a 304 response.
  app.addHook("preSerialization", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    return payload;
  });
  // Errors and non-JSON payloads also retain private headers at the final hook.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    reply.removeHeader("etag");
    return payload;
  });
  const limited = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  typed.get(
    "/backup/status",
    {
      preHandler: owner,
      schema: { response: { 200: BackupStatusView } },
    },
    (req) => backupService.status(db, req.firm.id, req.user.id),
  );

  typed.get(
    "/backup/export",
    {
      preHandler: owner,
      config: limited,
      schema: { response: { 200: BackupExportResponse } },
    },
    (req) => backupService.create(db, req.firm.id, req.user.id),
  );

  typed.post(
    "/backup/inspect",
    {
      preHandler: owner,
      config: limited,
      bodyLimit: MAX_FIRM_EXPORT_BYTES * 2 + 1024,
      schema: { body: BackupInspectInput, response: { 200: BackupInspection } },
    },
    (req) => backupService.inspect(db, req.firm.id, req.user.id, req.body.text),
  );

  typed.post(
    "/backup/restore-preview",
    {
      preHandler: owner,
      config: limited,
      bodyLimit: MAX_FIRM_EXPORT_BYTES * 2 + 2048,
      schema: {
        body: BackupRestorePreviewInput,
        response: { 200: BackupRestorePreview },
      },
    },
    (req) => restoreService.preview(db, req.firm.id, req.user.id, req.body),
  );

  typed.post(
    "/backup/restore",
    {
      preHandler: owner,
      config: limited,
      bodyLimit: MAX_FIRM_EXPORT_BYTES * 2 + 2048,
      schema: {
        body: BackupRestoreInput,
        response: { 200: BackupRestoreResult },
      },
    },
    (req) => restoreService.restore(db, req.firm.id, req.user.id, req.body),
  );

  typed.get(
    "/backup/recovery",
    { preHandler: owner, schema: { response: { 200: BackupRecoveryStatus } } },
    (req) => restoreService.recovery(db, req.firm.id, req.user.id),
  );
}

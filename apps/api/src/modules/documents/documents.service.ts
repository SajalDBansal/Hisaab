import type { StoredDocument, UploadRequest } from "@repo/contracts";
import { today, can, type Role, type DocumentFilters } from "@repo/core";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { canReadBooks } from "../../lib/read-permissions";
import { documentKey, type FileStorage } from "../../lib/storage";
import { notFound } from "@repo/backend/modules/masters/shared";
import { documentsRepo } from "./documents.repo";
import { savedReservationId } from "./documents.receipts";
import { scheduleDocumentCleanup } from "@repo/backend/modules/documents/cleanup";
import { requireRight } from "../vouchers/vouchers.service";
import { accountsService } from "../accounts/accounts.service";
import {
  rememberAnswer,
  replayOf,
  type Idem,
} from "@repo/backend/modules/vouchers/idempotency";
import {
  availableDocumentBytes,
  DocumentLimits,
  lockDocumentFirm,
  lockUploadKey,
  type DocumentOptions,
} from "./documents.quota";

type UploadOptions = DocumentOptions & {
  request?: { userId: string; idem?: Idem };
};

type DocumentRecord = NonNullable<
  Awaited<ReturnType<typeof documentsRepo.get>>
>;

export function toStoredDocument(row: DocumentRecord): StoredDocument {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    sizeKb: Math.ceil(row.sizeBytes / 1024),
    hasThumbnail: !!row.thumbnailKey && !!row.readyAt,
    uploadedOn: row.uploadedOn,
    folder: row.folder,
    ...(row.contentType
      ? { contentType: row.contentType as StoredDocument["contentType"] }
      : {}),
    ...(row.accountKey ? { accountKey: row.accountKey } : {}),
    ...(row.partyId ? { partyId: row.partyId } : {}),
    ...(row.voucherId ? { voucherId: row.voucherId } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

async function checkLinks(
  db: Db,
  firmId: string,
  input: UploadRequest,
  role: Role,
) {
  if (
    input.partyId &&
    !(await documentsRepo.partyExists(db, firmId, input.partyId))
  )
    throw new AppError("NOT_FOUND", "This party was not found.", 404);
  const voucher = input.voucherId
    ? await documentsRepo.voucherExists(db, firmId, input.voucherId)
    : undefined;
  if (input.voucherId && !voucher) throw notFound("voucher");
  if (voucher) {
    requireRight(role, voucher.type);
    if (input.partyId && input.partyId !== voucher.partyId)
      throw new AppError(
        "INVALID_LINK",
        "This party does not belong to the selected entry.",
        422,
      );
  }
  if (
    input.accountKey &&
    !(await accountsService.pickable(db, firmId)).some(
      (a) => a.key === input.accountKey,
    )
  )
    throw notFound("account");
  if (input.accountKey && !can(role, "accounts"))
    throw new AppError(
      "FORBIDDEN",
      "Your role cannot attach account documents.",
      403,
    );
  return voucher?.partyId ?? input.partyId ?? null;
}

async function editable(
  db: Db,
  firmId: string,
  id: string,
  role: Role,
  includeDeleted = false,
) {
  const row = await documentsRepo.get(
    db,
    firmId,
    id,
    undefined,
    includeDeleted,
  );
  if (!row) throw notFound("document");
  if (
    !canReadBooks(role) &&
    !(await documentsRepo.get(db, firmId, id, role, includeDeleted))
  )
    throw new AppError(
      "FORBIDDEN",
      "Your role cannot change this document.",
      403,
    );
  if (row.voucherId) {
    const voucher = await documentsRepo.voucherExists(
      db,
      firmId,
      row.voucherId,
    );
    if (!voucher) throw notFound("voucher");
    requireRight(role, voucher.type);
  } else if (!can(role, "settings") && !can(role, "accounts")) {
    throw new AppError(
      "FORBIDDEN",
      "Only the owner or accountant can change library documents.",
      403,
    );
  }
  return row;
}

async function uploadResponse(storage: FileStorage, row: DocumentRecord) {
  if (!row.s3Key || !row.contentType)
    throw new AppError(
      "UPLOAD_REQUIRED",
      "Select and upload this file again.",
      409,
    );
  // Sign only after the reservation transaction commits. A signing failure is retryable by key.
  const ticket = await storage.uploadUrl({
    key: row.s3Key,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  });
  return {
    document: toStoredDocument(row),
    key: row.s3Key,
    uploadUrl: ticket.url,
    expiresAt: ticket.expiresAt,
  };
}

async function reserveAgain(
  db: Db,
  firmId: string,
  id: string,
  role: Role,
  options: DocumentOptions,
  allowReady = false,
) {
  const limits = DocumentLimits.parse(options.limits ?? {});
  return db.transaction(async (tx) => {
    await lockDocumentFirm(tx, firmId, id);
    const connection = tx as unknown as Db;
    const row = await editable(connection, firmId, id, role);
    if (row.readyAt) {
      if (allowReady) return row;
      throw new AppError(
        "UPLOAD_CLOSED",
        "This upload is already complete.",
        409,
      );
    }
    await availableDocumentBytes(connection, firmId, row, limits, id);
    const saved = await documentsRepo.update(connection, firmId, id, {});
    if (!saved) throw notFound("document");
    return saved;
  });
}

export const documentsService = {
  async list(
    db: Db,
    firmId: string,
    role: Role,
    filters: DocumentFilters = {},
  ) {
    return (await documentsRepo.list(db, firmId, role, filters)).map((row) => ({
      ...toStoredDocument(row.document),
      partyName: row.partyName ?? undefined,
      voucherNumber: row.voucherNumber ?? undefined,
      entryDate: row.entryDate ?? undefined,
    }));
  },

  async uploadTicket(
    db: Db,
    storage: FileStorage,
    firmId: string,
    input: UploadRequest,
    role: Role,
    options: UploadOptions = {},
  ) {
    const limits = DocumentLimits.parse(options.limits ?? {});
    const id = await db.transaction(async (tx) => {
      const request = options.request;
      if (request?.idem)
        await lockUploadKey(tx, request.userId, request.idem.key);
      await lockDocumentFirm(tx, firmId);
      const connection = tx as unknown as Db;
      if (request?.idem) {
        const seen = await replayOf<unknown>(tx, request.userId, request.idem);
        if (seen) return savedReservationId(seen);
      }
      const partyId = await checkLinks(connection, firmId, input, role);
      if (!input.voucherId && !can(role, "settings") && !can(role, "accounts"))
        throw new AppError(
          "FORBIDDEN",
          "Attach documents through an entry, or ask the owner to add library documents.",
          403,
        );
      await availableDocumentBytes(connection, firmId, input, limits);
      const documentId = uuidv7();
      await documentsRepo.insert(connection, {
        id: documentId,
        firmId,
        name: input.name,
        kind: input.kind,
        sizeBytes: input.sizeBytes,
        s3Key: documentKey({
          firmId,
          documentId,
          name: input.name,
          contentType: input.contentType,
        }),
        partyId,
        contentType: input.contentType,
        folder: input.folder ?? "",
        accountKey: input.accountKey ?? null,
        voucherId: input.voucherId ?? null,
        note: input.note ?? null,
        uploadedOn: today(),
      });
      if (request?.idem)
        await rememberAnswer(tx, request.userId, request.idem, 201, {
          documentId,
        });
      return documentId;
    });
    return uploadResponse(
      storage,
      await reserveAgain(db, firmId, id, role, options, true),
    );
  },

  async confirm(
    db: Db,
    storage: FileStorage,
    firmId: string,
    id: string,
    role: Role,
    options: DocumentOptions = {},
  ) {
    // Serialize confirmation and deletion so a deleted document cannot be resurrected.
    return db.transaction(async (tx) => {
      await lockDocumentFirm(tx, firmId, id);
      const connection = tx as unknown as Db;
      const row = await editable(connection, firmId, id, role);
      if (row.readyAt) return toStoredDocument(row);
      if (!row.s3Key || !row.contentType)
        throw new AppError(
          "UPLOAD_REQUIRED",
          "Select and upload this file again.",
          409,
        );
      const maximum = await availableDocumentBytes(
        connection,
        firmId,
        row,
        DocumentLimits.parse(options.limits ?? {}),
        id,
      );
      const savedFile = await storage.finalize({
        key: row.s3Key,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        maxSizeBytes: maximum,
      });
      await availableDocumentBytes(
        connection,
        firmId,
        savedFile,
        DocumentLimits.parse(options.limits ?? {}),
        id,
      );
      const saved = await documentsRepo.update(connection, firmId, id, {
        ...savedFile,
        readyAt: new Date(),
      });
      if (!saved) throw notFound("document");
      return toStoredDocument(saved);
    });
  },

  async renew(
    db: Db,
    storage: FileStorage,
    firmId: string,
    id: string,
    role: Role,
    options: DocumentOptions = {},
  ) {
    return uploadResponse(
      storage,
      await reserveAgain(db, firmId, id, role, options),
    );
  },

  async update(
    db: Db,
    firmId: string,
    id: string,
    role: Role,
    patch: { folder: string; note?: string },
  ) {
    await editable(db, firmId, id, role);
    const row = await documentsRepo.update(db, firmId, id, patch, true);
    if (!row) throw notFound("document");
    return toStoredDocument(row);
  },

  async downloadTicket(
    db: Db,
    storage: FileStorage,
    firmId: string,
    id: string,
    role: Role,
    thumbnail = false,
  ) {
    const row = await documentsRepo.get(db, firmId, id, role);
    if (!row?.s3Key || !row.readyAt) throw notFound("document");
    const key = thumbnail ? row.thumbnailKey : row.s3Key;
    if (!key) throw notFound("thumbnail");
    const ticket = await storage.downloadUrl(key);
    return { downloadUrl: ticket.url, expiresAt: ticket.expiresAt };
  },

  async remove(
    db: Db,
    _storage: FileStorage,
    firmId: string,
    id: string,
    role: Role,
  ) {
    await db.transaction(async (tx) => {
      await lockDocumentFirm(tx, firmId, id);
      const connection = tx as unknown as Db;
      const row = await editable(connection, firmId, id, role, true);
      if (row.deletedAt) return;
      const deletedAt = new Date();
      await documentsRepo.softDelete(connection, firmId, id, deletedAt);
      if (row.s3Key)
        await scheduleDocumentCleanup(connection, {
          documentId: id,
          firmId,
          objectKey: row.s3Key,
          thumbnailKey: row.thumbnailKey,
          deletedAt,
        });
    });
  },
};

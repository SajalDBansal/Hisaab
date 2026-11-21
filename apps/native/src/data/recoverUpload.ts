import {
  RECOVERY_EPOCH_HEADER,
  StoredDocument,
  UploadRequest,
  UploadTicket,
} from "@repo/contracts";
import { z } from "zod";
import type { AttachmentRecord } from "./attachmentRecovery";
import type { Transport } from "./client";

/** Reconcile an existing reservation; an absent answer never creates a replacement upload. */
export async function recoverUpload(
  record: AttachmentRecord,
  transport: Transport,
  epoch: string,
) {
  if (
    record.reservation &&
    record.reservation.firstAttemptAt === undefined &&
    !record.progress &&
    !record.completed
  )
    return {};
  const input = UploadRequest.parse({
    ...(record.input ?? {
      name: record.file.name,
      kind: "bill",
      ...(record.scope.target === "voucher"
        ? { voucherId: record.scope.entryId }
        : record.scope.target === "account"
          ? { accountKey: record.scope.entryId }
          : {}),
    }),
    contentType: record.file.contentType,
    sizeBytes: record.file.sizeBytes,
  });
  if (record.scope.target === "library" && !record.input)
    throw new Error(
      "Keep this library copy until its original upload details can be reconciled.",
    );
  const headers = {
    "x-firm-id": record.scope.firmId,
    [RECOVERY_EPOCH_HEADER]: epoch,
  };
  const answer = z
    .discriminatedUnion("state", [
      z.object({ state: z.literal("found"), id: z.uuid() }),
      z.object({ state: z.literal("unknown"), message: z.string() }),
    ])
    .parse(
      await transport(`/v1/operations/${record.id}/document-reservation`, {
        body: input,
        headers,
      }),
    );
  if (answer.state !== "found") throw new Error(answer.message);
  const previous = record.completed?.id ?? record.progress?.ticket.document.id;
  if (previous && previous !== answer.id)
    throw new Error(
      "The restored reservation differs from the saved document. Keep the file for manual reconciliation.",
    );
  try {
    const ticket = UploadTicket.parse(
      await transport(`/v1/documents/${answer.id}/upload-url`, { headers }),
    );
    return { progress: { ticket, uploaded: false }, completed: undefined };
  } catch (error) {
    if ((error as { code?: string }).code !== "UPLOAD_CLOSED") throw error;
    const completed = StoredDocument.parse(
      await transport(`/v1/documents/${answer.id}/confirm`, {
        body: {},
        headers,
      }),
    );
    return { completed };
  }
}

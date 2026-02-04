import type { NewDocumentInput } from "@repo/core";
import {
  attachmentReservationProblem,
  type AttachmentRecord,
  type PendingAttachment,
} from "@/data/attachmentRecovery";

export function pendingAttachmentInput(
  record: AttachmentRecord,
): NewDocumentInput {
  if (record.input) return record.input;
  if (record.scope.target === "library")
    throw new Error("Open the library upload to finish its document details.");
  return {
    name: record.file.name,
    kind: "bill",
    ...(record.scope.target === "voucher"
      ? { voucherId: record.scope.entryId }
      : { accountKey: record.scope.entryId }),
  };
}

export function pendingAttachmentProblem({
  record,
  fileError,
}: PendingAttachment) {
  if (record.bindingPending)
    return "Entry saved; finish its attachment binding in the retained draft below.";
  if (record.completed) return "Upload confirmed; local cleanup pending.";
  if (
    fileError &&
    !record.progress?.uploaded &&
    !attachmentReservationProblem(record)
  )
    return fileError;
  if (record.scope.target === "library" && !record.input)
    return "Open the library upload to finish its document details.";
  return undefined;
}

export function pendingAttachmentRoute(record: AttachmentRecord) {
  if (record.scope.target === "voucher")
    return {
      pathname: "/voucher/[id]" as const,
      params: { id: record.scope.entryId },
    };
  if (record.scope.target === "account")
    return {
      pathname: "/account/[key]" as const,
      params: { key: record.scope.entryId },
    };
  return { pathname: "/settings/documents" as const };
}

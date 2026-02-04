import { z } from "zod";
import {
  AttachmentRecord,
  AttachmentScope,
  attachmentScopeKey,
} from "./attachmentRecovery";
import { sealLocal, openLocal } from "./offlineStore";

const Envelope = z.object({
  id: z.uuid(),
  scope: AttachmentScope,
  sealedRecord: z.string(),
});
const key = (record: { id: string; scope: AttachmentScope }) =>
  `attachment-draft:${attachmentScopeKey(record.scope)}:${record.id}`;
export type StoredAttachmentRecord =
  AttachmentRecord | z.infer<typeof Envelope>;
export async function encodeAttachmentRecord(
  record: AttachmentRecord,
): Promise<StoredAttachmentRecord> {
  // Old manifests remain readable. New financial payloads never enter plaintext metadata.
  if (!record.draft) return record;
  return {
    id: record.id,
    scope: record.scope,
    sealedRecord: await sealLocal(key(record), JSON.stringify(record)),
  };
}
export async function decodeAttachmentRecord(value: unknown) {
  const envelope = Envelope.safeParse(value);
  if (!envelope.success) return AttachmentRecord.parse(value);
  const record = AttachmentRecord.parse(
    JSON.parse(await openLocal(key(envelope.data), envelope.data.sealedRecord)),
  );
  if (key(record) !== key(envelope.data))
    throw new Error("The encrypted draft owner does not match.");
  return record;
}
export const attachmentRecordHeader = z.object({
  id: z.uuid(),
  scope: AttachmentScope,
});

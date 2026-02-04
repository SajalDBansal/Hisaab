import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import type { DocumentFile } from "@repo/core";
import {
  attachmentRecordHeader,
  decodeAttachmentRecord,
  encodeAttachmentRecord,
} from "./attachmentRecordCodec";
import {
  AttachmentRecord,
  attachmentLock,
  attachmentScopeKey,
  attachmentOwnedBy,
  type AttachmentScope,
  type AttachmentStorage,
} from "./attachmentRecovery";

async function scopeDirectory(scope: AttachmentScope) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    attachmentScopeKey(scope),
  );
  return new Directory(Paths.document, "attachment-recovery-v1", hash);
}

async function recordDirectory(scope: AttachmentScope, id: string) {
  const safeId = AttachmentRecord.shape.id.parse(id);
  return new Directory(await scopeDirectory(scope), safeId);
}

async function read(scope: AttachmentScope, id: string) {
  const directory = await recordDirectory(scope, id);
  const published = new File(directory, "record.json");
  const next = new File(directory, "record.next");
  // Expo replaces files by removing the old destination; keep the next record recoverable.
  const manifest = published.exists ? published : next;
  if (!manifest.exists) return null;
  const record = await decodeAttachmentRecord(
    JSON.parse(await manifest.text()),
  );
  if (
    record.id !== id ||
    attachmentScopeKey(record.scope) !== attachmentScopeKey(scope)
  )
    throw new Error("The pending attachment owner does not match.");
  return record;
}

export const attachmentStorage: AttachmentStorage = {
  async scopes(owner) {
    const root = new Directory(Paths.document, "attachment-recovery-v1");
    if (!root.exists) return [];
    const scopes = new Map<string, AttachmentScope>();
    for (const directory of root.list()) {
      if (
        !(directory instanceof Directory) ||
        !/^[a-f0-9]{64}$/.test(directory.name)
      )
        continue;
      for (const entry of directory.list()) {
        if (
          !(entry instanceof Directory) ||
          !AttachmentRecord.shape.id.safeParse(entry.name).success
        )
          continue;
        const published = new File(entry, "record.json");
        const next = new File(entry, "record.next");
        const manifest = published.exists ? published : next;
        if (!manifest.exists) continue;
        // Unattributable/corrupt directories are retained, never swept while listing.
        let value: unknown;
        try {
          value = JSON.parse(await manifest.text());
        } catch {
          continue;
        }
        const parsed = attachmentRecordHeader.safeParse(value);
        if (!parsed.success || !attachmentOwnedBy(parsed.data.scope, owner))
          continue;
        const record = parsed.data;
        if (
          record.id !== entry.name ||
          (await scopeDirectory(record.scope)).uri !== directory.uri
        )
          continue;
        scopes.set(attachmentScopeKey(record.scope), record.scope);
      }
    }
    return [...scopes.values()];
  },
  async list(scope) {
    const directory = await scopeDirectory(scope);
    if (!directory.exists) return [];
    const records: AttachmentRecord[] = [];
    for (const entry of directory.list()) {
      if (
        !(entry instanceof Directory) ||
        !AttachmentRecord.shape.id.safeParse(entry.name).success
      )
        continue;
      const record = await read(scope, entry.name);
      if (record) records.push(record);
    }
    return records;
  },
  read,
  async write(record, source) {
    AttachmentRecord.parse(record);
    const directory = await recordDirectory(record.scope, record.id);
    directory.create({ intermediates: true, idempotent: true });
    const content = new File(directory, "content");
    if (source) {
      if (
        content.exists &&
        (new File(directory, "record.json").exists ||
          new File(directory, "record.next").exists)
      )
        throw new Error("This attachment is already queued.");
      try {
        // Resume an interrupted unpublished copy at its stable draft destination ID.
        if (content.exists && content.size !== record.file.sizeBytes)
          content.delete();
        if (!content.exists) await new File(source.uri).copy(content);
        if (content.size !== record.file.sizeBytes)
          throw new Error(
            "Couldn't preserve the complete attachment. Select it again.",
          );
      } catch (error) {
        if (content.exists) content.delete();
        throw error;
      }
    }
    // Publish metadata only after the private file copy is complete.
    const temporary = new File(directory, "record.next");
    const published = new File(directory, "record.json");
    if (!published.exists && temporary.exists) await temporary.move(published);
    const next = new File(directory, "record.next");
    next.write(
      JSON.stringify(
        await encodeAttachmentRecord(AttachmentRecord.parse(record)),
      ),
    );
    await next.move(published, { overwrite: true });
  },
  async open(record): Promise<DocumentFile> {
    const content = new File(
      await recordDirectory(record.scope, record.id),
      "content",
    );
    if (!content.exists || content.size !== record.file.sizeBytes)
      throw new Error(
        "A pending attachment is missing from this device. Select the file again.",
      );
    return { ...record.file, uri: content.uri };
  },
  async remove(record) {
    const directory = await recordDirectory(record.scope, record.id);
    // This path is constructed from the fixed queue root, scope hash and validated UUID only.
    if (directory.exists) directory.delete();
  },
  release: () => {},
  lock: attachmentLock,
};

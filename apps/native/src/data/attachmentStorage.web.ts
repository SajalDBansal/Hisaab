import type { DocumentFile } from "@repo/core";
import {
  decodeAttachmentRecord,
  encodeAttachmentRecord,
  type StoredAttachmentRecord,
} from "./attachmentRecordCodec";
import {
  AttachmentRecord,
  AttachmentScope,
  attachmentScopeKey,
  attachmentOwnedBy,
  type AttachmentStorage,
} from "./attachmentRecovery";

type Row = {
  key: string;
  scopeKey: string;
  record: StoredAttachmentRecord;
  blob?: Blob;
};
const databaseName = "hisaab-attachment-recovery-v1";
const objectUrls = new Set<string>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "Attachment recovery storage is unavailable in this browser.",
        ),
      );
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("attachments", {
        keyPath: "key",
      });
      store.createIndex("scope", "scopeKey");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other Hisaab tabs and try again."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("attachments", mode, { durability: "strict" });
      const request = work(tx.objectStore("attachments"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Couldn't save the pending attachment."));
      tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

const rowKey = (scope: AttachmentScope, id: string) =>
  `${attachmentScopeKey(scope)}:${AttachmentRecord.shape.id.parse(id)}`;

async function readRow(
  scope: AttachmentScope,
  id: string,
): Promise<Row | undefined> {
  const row: Row | undefined = await transaction("readonly", (store) =>
    store.get(rowKey(scope, id)),
  );
  if (row) {
    row.record = await decodeAttachmentRecord(row.record);
    if (
      row.record.id !== id ||
      attachmentScopeKey(row.record.scope) !== attachmentScopeKey(scope)
    )
      throw new Error("The pending attachment owner does not match.");
  }
  return row;
}

export const attachmentStorage: AttachmentStorage = {
  async scopes(owner) {
    const db = await openDatabase();
    try {
      return await new Promise<AttachmentScope[]>((resolve, reject) => {
        const scopes: AttachmentScope[] = [];
        const tx = db.transaction("attachments", "readonly");
        // Read distinct scope keys without loading every private blob into memory.
        const request = tx
          .objectStore("attachments")
          .index("scope")
          .openKeyCursor(null, "nextunique");
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          try {
            const [userId, firmId, target, entryId] = JSON.parse(
              String(cursor.key),
            );
            const parsed = AttachmentScope.safeParse({
              userId,
              firmId,
              target,
              entryId,
            });
            if (
              parsed.success &&
              attachmentOwnedBy(parsed.data, owner) &&
              attachmentScopeKey(parsed.data) === cursor.key
            )
              scopes.push(parsed.data);
          } catch {
            /* Leave unrecognizable rows untouched. */
          }
          cursor.continue();
        };
        tx.oncomplete = () => resolve(scopes);
        tx.onerror = () => reject(tx.error ?? request.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("Couldn't read pending uploads."));
      });
    } finally {
      db.close();
    }
  },
  async list(scope) {
    const rows: Row[] = await transaction("readonly", (store) =>
      store.index("scope").getAll(attachmentScopeKey(scope)),
    );
    return Promise.all(
      rows.map(async (row) => {
        const record = await decodeAttachmentRecord(row.record);
        if (
          attachmentScopeKey(record.scope) !== attachmentScopeKey(scope) ||
          row.key !== rowKey(scope, record.id)
        )
          throw new Error("The pending attachment owner does not match.");
        return record;
      }),
    );
  },
  async read(scope, id) {
    const row = await readRow(scope, id);
    return row ? AttachmentRecord.parse(row.record) : null;
  },
  async write(record, source) {
    record = AttachmentRecord.parse(record);
    let blob: Blob | undefined;
    if (source) {
      const response = await fetch(source.uri);
      if (!response.ok)
        throw new Error("Couldn't read the selected attachment.");
      blob = await response.blob();
    } else {
      const existing = await readRow(record.scope, record.id);
      if (!existing) throw new Error("This pending attachment was removed.");
      blob = existing.blob;
    }
    if (source && (!blob || blob.size !== record.file.sizeBytes))
      throw new Error(
        "The pending attachment is missing. Select the file again.",
      );
    const row: Row = {
      key: rowKey(record.scope, record.id),
      scopeKey: attachmentScopeKey(record.scope),
      record: await encodeAttachmentRecord(record),
      blob,
    };
    await transaction("readwrite", (store) =>
      source ? store.add(row) : store.put(row),
    );
  },
  async open(record): Promise<DocumentFile> {
    const row = await readRow(record.scope, record.id);
    if (!row?.blob || row.blob.size !== record.file.sizeBytes)
      throw new Error(
        "The pending attachment is missing. Select the file again.",
      );
    const uri = URL.createObjectURL(row.blob);
    objectUrls.add(uri);
    return { ...record.file, uri };
  },
  async remove(record) {
    await transaction("readwrite", (store) =>
      store.delete(rowKey(record.scope, record.id)),
    );
  },
  release(file) {
    if (objectUrls.delete(file.uri)) URL.revokeObjectURL(file.uri);
  },
  lock: (key, work) =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`attachment:${key}`, work)
      : Promise.reject(
          new Error(
            "This browser cannot safely coordinate pending uploads across tabs. Open Hisaab in a browser with Web Locks support.",
          ),
        ),
};

import { z } from "zod";
import {
  NewDocumentInput as DocumentInput,
  StoredDocument,
  UploadTicket,
} from "@repo/contracts";
import type { DocumentFile, NewDocumentInput } from "@repo/core";
import { AttachmentDraft, AttachmentFileInfo } from "./attachmentDraftModel";

export const AttachmentScope = z.object({
  userId: z.string().min(1),
  firmId: z.string().min(1),
  target: z.enum(["voucher", "account", "library", "draft"]),
  entryId: z.string().min(1),
});
export type AttachmentScope = z.infer<typeof AttachmentScope>;
export type AttachmentOwner = Pick<AttachmentScope, "userId" | "firmId">;
export type AttachmentReference = Pick<AttachmentRecord, "id" | "scope">;
export type PendingAttachment = {
  record: AttachmentRecord;
  fileError?: string;
};

export const attachmentOwnedBy = (
  scope: AttachmentScope,
  owner: AttachmentOwner,
) => scope.userId === owner.userId && scope.firmId === owner.firmId;

// The server currently purges shared keys after seven days. Leave a day of margin.
export const attachmentReservationRetryMs = 6 * 24 * 60 * 60 * 1000;
export function attachmentReservationProblem(
  record: AttachmentRecord,
  now = Date.now(),
) {
  if (record.progress || record.completed) return undefined;
  const started = record.reservation?.firstAttemptAt;
  if (
    !record.reservation ||
    (started !== undefined &&
      (now < started || now - started >= attachmentReservationRetryMs))
  )
    return "This upload reservation needs reconciliation before retry. Keep this copy until the original reservation can be checked.";
  return undefined;
}

export const AttachmentProgress = z.object({
  ticket: UploadTicket,
  uploaded: z.boolean(),
});
export type AttachmentProgress = z.infer<typeof AttachmentProgress>;

export const AttachmentRecord = z.object({
  version: z.literal(1),
  id: z.uuid(),
  order: z.number().int().nonnegative(),
  scope: AttachmentScope,
  file: AttachmentFileInfo,
  draft: AttachmentDraft.optional(),
  bindingPending: z.boolean().optional(),
  draftOrigin: z
    .object({ operationId: z.uuid(), sourceId: z.uuid() })
    .optional(),
  progress: AttachmentProgress.optional(),
  input: DocumentInput.optional(),
  completed: StoredDocument.optional(),
  reservation: z
    .object({ firstAttemptAt: z.number().int().nonnegative().optional() })
    .optional(),
  failure: z
    .object({
      message: z.string().max(1000),
      at: z.number().int().nonnegative(),
    })
    .optional(),
});
export type AttachmentRecord = z.infer<typeof AttachmentRecord>;

export const attachmentScopeKey = (scope: AttachmentScope) =>
  JSON.stringify([scope.userId, scope.firmId, scope.target, scope.entryId]);

export interface AttachmentStorage {
  scopes(owner: AttachmentOwner): Promise<AttachmentScope[]>;
  list(scope: AttachmentScope): Promise<AttachmentRecord[]>;
  read(scope: AttachmentScope, id: string): Promise<AttachmentRecord | null>;
  write(record: AttachmentRecord, source?: DocumentFile): Promise<void>;
  open(record: AttachmentRecord): Promise<DocumentFile>;
  remove(record: AttachmentRecord): Promise<void>;
  release(file: DocumentFile): void;
  lock<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface AttachmentRetry {
  id: string;
  key: string;
  scope: AttachmentScope;
  fileError?: string;
  assertActive(): void;
  run<T>(work: () => Promise<T>): Promise<T>;
  read(): Promise<AttachmentRecord>;
  save(progress: AttachmentProgress): Promise<void>;
  prepare(input: NewDocumentInput): Promise<void>;
  reserve(): Promise<void>;
  fail(error: unknown): Promise<void>;
  verifyFile(): Promise<void>;
  upload(work: (file: DocumentFile) => Promise<void>): Promise<void>;
  complete(document: z.infer<typeof StoredDocument>): Promise<void>;
}

// Runtime bindings carry no authentication secrets and never enter the API body.
const retries = new WeakMap<DocumentFile, AttachmentRetry>();
export const attachmentRetry = (file: DocumentFile) => retries.get(file);

export function checkAttachmentTarget(
  retry: AttachmentRetry,
  input: NewDocumentInput,
) {
  retry.assertActive();
  const { target, entryId } = retry.scope;
  if (target === "draft")
    throw new Error(
      "Recover the original financial save before uploading its attachments.",
    );
  if (
    (target === "voucher" &&
      (input.voucherId !== entryId || input.accountKey !== undefined)) ||
    (target === "account" &&
      (input.accountKey !== entryId || input.voucherId !== undefined))
  )
    throw new Error("This attachment belongs to a different entry.");
}

const locks = new Map<string, Promise<unknown>>();
export async function attachmentLock<T>(key: string, work: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export function createAttachmentQueue(
  storage: AttachmentStorage,
  newId: () => string,
) {
  const assertScope = (scope: AttachmentScope) => {
    AttachmentScope.parse(scope);
    if (scope.userId === "signed-out")
      throw new Error("Sign in before recovering attachments.");
  };
  const assertOwner = (owner: AttachmentOwner) =>
    assertScope({ ...owner, target: "library", entryId: "library" });
  const assertReference = (
    owner: AttachmentOwner,
    reference: AttachmentReference,
  ) => {
    assertOwner(owner);
    assertScope(reference.scope);
    AttachmentRecord.shape.id.parse(reference.id);
    if (!attachmentOwnedBy(reference.scope, owner))
      throw new Error(
        "This attachment belongs to a different account or firm.",
      );
  };

  async function bind(record: AttachmentRecord, assertActive: () => void) {
    let file: DocumentFile;
    let fileError: string | undefined;
    try {
      file = await storage.open(record);
    } catch (error) {
      file = { ...record.file, uri: "" };
      fileError =
        error instanceof Error
          ? error.message
          : "The pending file is missing. Select it again.";
    }
    const key = attachmentScopeKey(record.scope);
    const read = async () => {
      const saved = await storage.read(record.scope, record.id);
      if (!saved) throw new Error("This pending attachment was removed.");
      if (attachmentScopeKey(saved.scope) !== key || saved.id !== record.id)
        throw new Error("The pending attachment owner does not match.");
      if (saved.bindingPending)
        throw new Error(
          "Finish the saved entry's attachment binding in Pending uploads first.",
        );
      return saved;
    };
    retries.set(file, {
      id: record.id,
      key: `${key}:${record.id}`,
      scope: record.scope,
      fileError,
      assertActive,
      run: (work) => storage.lock(key, work),
      read,
      save: async (progress) =>
        storage.write({ ...(await read()), progress, failure: undefined }),
      prepare: async (input) => {
        const saved = await read();
        const parsed = DocumentInput.parse(input);
        if (
          saved.input &&
          JSON.stringify(saved.input) !== JSON.stringify(parsed)
        )
          throw new Error(
            "Restore the pending document's original upload details before retrying.",
          );
        assertActive();
        await storage.write({ ...saved, input: parsed, failure: undefined });
      },
      reserve: async () => {
        const saved = await read();
        const problem = attachmentReservationProblem(saved);
        if (problem) throw new Error(problem);
        assertActive();
        await storage.write({
          ...saved,
          reservation: {
            firstAttemptAt: saved.reservation?.firstAttemptAt ?? Date.now(),
          },
        });
      },
      fail: async (error) => {
        const saved = await storage.read(record.scope, record.id);
        if (saved && !saved.completed)
          await storage.write({
            ...saved,
            failure: {
              message: (error instanceof Error
                ? error.message
                : "The file transfer failed."
              ).slice(0, 1000),
              at: Date.now(),
            },
          });
      },
      verifyFile: async () => {
        const current = await storage.open(await read());
        storage.release(current);
        assertActive();
      },
      upload: async (work) => {
        const current = await storage.open(await read());
        try {
          assertActive();
          await work(current);
        } finally {
          storage.release(current);
        }
      },
      complete: async (completed) => {
        const saved = await storage.read(record.scope, record.id);
        if (saved)
          await storage.write({ ...saved, completed, failure: undefined });
      },
    });
    return file;
  }

  async function load(scope: AttachmentScope, assertActive: () => void) {
    assertScope(scope);
    if (scope.target === "draft")
      throw new Error("Open the financial draft in Pending uploads.");
    return storage.lock(attachmentScopeKey(scope), async () => {
      assertActive();
      const files: DocumentFile[] = [];
      try {
        const records = await storage.list(scope);
        for (const record of records.sort((a, b) => a.order - b.order)) {
          assertActive();
          if (record.bindingPending) continue;
          if (record.completed) {
            await storage.remove(record).catch(() => {});
          } else files.push(await bind(record, assertActive));
        }
        assertActive();
        return files;
      } catch (error) {
        files.forEach(storage.release);
        throw error;
      }
    });
  }

  async function stage(
    scope: AttachmentScope,
    files: DocumentFile[],
    assertActive: () => void,
  ) {
    assertScope(scope);
    if (files.length > 10) throw new Error("Attach up to 10 files at a time.");
    return storage.lock(attachmentScopeKey(scope), async () => {
      assertActive();
      for (const file of files) {
        const retry = attachmentRetry(file);
        if (!retry) continue;
        retry.assertActive();
        if (attachmentScopeKey(retry.scope) !== attachmentScopeKey(scope))
          throw new Error("This attachment belongs to a different entry.");
      }
      const result: DocumentFile[] = [];
      const created: AttachmentRecord[] = [];
      const existing = await storage.list(scope);
      let order = Math.max(-1, ...existing.map((record) => record.order)) + 1;
      try {
        for (const file of files) {
          const retry = attachmentRetry(file);
          if (retry) {
            if (!(await retry.read()).completed) result.push(file);
            continue;
          }
          const { uri: _uri, ...details } = file;
          const record = AttachmentRecord.parse({
            version: 1,
            id: newId(),
            order: order++,
            scope,
            file: details,
            reservation: {},
          });
          await storage.write(record, file);
          created.push(record);
          result.push(await bind(record, assertActive));
        }
      } catch (error) {
        result.filter((file) => !files.includes(file)).forEach(storage.release);
        for (const record of created)
          await storage.remove(record).catch(() => {});
        throw error;
      }
      try {
        assertActive();
        return result;
      } catch (error) {
        // A scope change stops requests, but leaves copied files with their original owner.
        result.filter((file) => !files.includes(file)).forEach(storage.release);
        throw error;
      }
    });
  }

  async function discard(file: DocumentFile) {
    const retry = attachmentRetry(file);
    if (!retry) return;
    await retry.run(async () => {
      retry.assertActive();
      const record = await storage.read(retry.scope, retry.id);
      retry.assertActive();
      if (record?.bindingPending || record?.scope.target === "draft")
        throw new Error("Open this financial draft in Pending uploads first.");
      if (record && !record.completed) await storage.remove(record);
      storage.release(file);
    });
  }

  async function describe(
    scope: AttachmentScope,
    files: DocumentFile[],
    details: Omit<NewDocumentInput, "name">,
    assertActive: () => void,
  ) {
    return storage.lock(attachmentScopeKey(scope), async () => {
      assertScope(scope);
      assertActive();
      if (scope.target === "library") {
        const existing = (await storage.list(scope)).find(
          (record) => record.input && !record.completed,
        )?.input;
        if (
          existing &&
          JSON.stringify(existing) !==
            JSON.stringify(
              DocumentInput.parse({ ...details, name: existing.name }),
            )
        )
          throw new Error(
            "Pending upload details cannot change. Finish or remove the current library batch first.",
          );
      }
      const changes: AttachmentRecord[] = [];
      for (const file of files) {
        const retry = attachmentRetry(file);
        if (
          !retry ||
          attachmentScopeKey(retry.scope) !== attachmentScopeKey(scope)
        )
          throw new Error("This attachment belongs to a different entry.");
        const record = await retry.read();
        const input = DocumentInput.parse({ ...details, name: file.name });
        if (
          record.input &&
          JSON.stringify(record.input) !== JSON.stringify(input)
        )
          throw new Error(
            "Pending upload details cannot change. Remove the pending files before starting a different upload.",
          );
        changes.push({ ...record, input });
      }
      // Freeze metadata before reserving any document, including a request with a lost reply.
      for (const record of changes) await storage.write(record);
      assertActive();
    });
  }

  async function complete(
    file: DocumentFile,
    document: z.infer<typeof StoredDocument>,
  ) {
    const retry = attachmentRetry(file);
    if (!retry) return;
    await retry.run(async () => {
      // Save the receipt before cleanup, so a cleanup failure cannot create another document.
      await retry.complete(document);
      const record = await storage.read(retry.scope, retry.id);
      if (record) await storage.remove(record).catch(() => {});
      storage.release(file);
    });
  }

  async function enumerate(owner: AttachmentOwner, assertActive: () => void) {
    assertOwner(owner);
    assertActive();
    const result: PendingAttachment[] = [];
    for (const scope of await storage.scopes(owner)) {
      if (!attachmentOwnedBy(scope, owner))
        throw new Error("The pending attachment owner does not match.");
      if (scope.target === "draft") continue;
      await storage.lock(attachmentScopeKey(scope), async () => {
        assertActive();
        for (const record of await storage.list(scope)) {
          let fileError: string | undefined;
          if (!record.completed) {
            try {
              const file = await storage.open(record);
              storage.release(file);
            } catch (error) {
              fileError =
                error instanceof Error ? error.message : "Local copy missing.";
            }
          }
          result.push({ record, fileError });
        }
        assertActive();
      });
    }
    assertActive();
    return result.sort(
      (a, b) =>
        attachmentScopeKey(a.record.scope).localeCompare(
          attachmentScopeKey(b.record.scope),
        ) || a.record.order - b.record.order,
    );
  }

  async function open(
    owner: AttachmentOwner,
    reference: AttachmentReference,
    assertActive: () => void,
  ) {
    assertReference(owner, reference);
    return storage.lock(attachmentScopeKey(reference.scope), async () => {
      assertActive();
      const record = await storage.read(reference.scope, reference.id);
      if (!record) throw new Error("This pending attachment was removed.");
      assertActive();
      return bind(record, assertActive);
    });
  }

  async function discardMany(
    owner: AttachmentOwner,
    references: AttachmentReference[],
    assertActive: () => void,
  ) {
    // Validate the whole selection before deleting any copy. Never expand a confirmed snapshot.
    references.forEach((reference) => assertReference(owner, reference));
    const result = {
      discarded: 0,
      completed: 0,
      missing: 0,
      failures: [] as { id: string; message: string }[],
    };
    const seen = new Set<string>();
    for (const reference of references) {
      assertActive();
      const key = `${attachmentScopeKey(reference.scope)}:${reference.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await storage.lock(attachmentScopeKey(reference.scope), async () => {
        assertActive();
        const record = await storage.read(reference.scope, reference.id);
        assertActive();
        if (!record) result.missing++;
        else if (record.completed) result.completed++;
        else if (record.bindingPending || record.scope.target === "draft")
          result.failures.push({
            id: record.id,
            message:
              "Finish the original financial draft in Pending uploads first.",
          });
        else {
          try {
            await storage.remove(record);
            result.discarded++;
          } catch (error) {
            result.failures.push({
              id: record.id,
              message:
                error instanceof Error ? error.message : "Cleanup failed.",
            });
          }
        }
      });
    }
    return result;
  }

  async function cleanupCompleted(
    owner: AttachmentOwner,
    references: AttachmentReference[],
    assertActive: () => void,
  ) {
    references.forEach((reference) => assertReference(owner, reference));
    for (const reference of references) {
      await storage.lock(attachmentScopeKey(reference.scope), async () => {
        assertActive();
        const record = await storage.read(reference.scope, reference.id);
        assertActive();
        if (record?.completed) await storage.remove(record);
      });
    }
  }

  return {
    load,
    stage,
    describe,
    discard,
    complete,
    enumerate,
    open,
    discardMany,
    cleanupCompleted,
    release: storage.release,
  };
}

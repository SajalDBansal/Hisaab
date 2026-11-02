import { z } from "zod";
import {
  BatchReadResult,
  MAX_BATCH_READS,
  OFFLINE_READABLE_PATH,
  RECOVERY_EPOCH_HEADER,
  RECOVERY_REQUIRED,
  RecoveryEpoch,
} from "@repo/contracts";
import { ApiFailure } from "../auth/apiFailure";
import {
  serverRecovery,
  recoveryRequired,
  recoveryMessage,
} from "./recoveryEpoch";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import type { RequestOptions, Transport } from "./client";
import type { OfflineStore } from "./offlineStore.types";
import {
  OfflineScope,
  OperationInput,
  OperationResult,
  OfflineWriteError,
  PendingOperationError,
  immutable,
  networkFailure,
  offlineDefinition,
  offlineKey,
  requestIdentity,
  validateOperation,
  validatedResult,
} from "./offlineOperation";

export const OutboxEntry = z.object({
  key: z.string().min(8),
  request: OperationInput,
  createdAt: z.number(),
  state: z.enum([
    "queued",
    "sending",
    "unknown",
    "blocked",
    "conflict",
    "committed",
    "cancelled",
    "superseded",
    "retained",
  ]),
  firstAttemptAt: z.number().optional(),
  result: OperationResult.optional(),
  error: z.string().optional(),
  replacedBy: z.string().optional(),
  sourceKey: z.string().optional(),
  attachmentDraft: z.boolean().optional(),
  pendingStorageKey: z.string().optional(),
  recoveryEpoch: RecoveryEpoch.optional(),
  recoveryReview: z
    .object({ epoch: RecoveryEpoch, note: z.string(), at: z.number() })
    .optional(),
  recoveryLookup: z
    .object({ epoch: RecoveryEpoch, result: OperationResult })
    .optional(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;
const Journal = z.object({
  version: z.literal(1),
  scope: OfflineScope,
  entries: z.array(OutboxEntry),
  recoveryEpoch: RecoveryEpoch.optional(),
  quarantine: z
    .object({
      previous: RecoveryEpoch.optional(),
      current: RecoveryEpoch,
      detectedAt: z.number(),
    })
    .optional(),
});
const ReadCache = z.object({
  reads: z.record(
    z.string(),
    z.object({ at: z.number(), response: z.unknown() }),
  ),
  downloadedAt: z.number().optional(),
  recoveryEpoch: RecoveryEpoch.optional(),
});
const terminal = (entry: OutboxEntry) =>
  ["committed", "cancelled", "superseded", "retained"].includes(entry.state);
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not be synchronized.";
const readKey = (path: string) => {
  const url = new URL(path, "https://local.invalid");
  url.searchParams.sort();
  return url.pathname + url.search;
};
/** Reads kept for offline viewing: the same list the server batches. */
const cacheable = (path: string) => OFFLINE_READABLE_PATH.test(path);

/** Outbox hints are local metadata, never HTTP headers on online-only requests. */
function withoutOfflineHints(options: RequestOptions): RequestOptions {
  if (!options.headers) return options;
  return {
    ...options,
    headers: Object.fromEntries(
      Object.entries(options.headers).filter(
        ([name]) =>
          !/^x-hisaab-(legacy-operation|attachment-draft|pending-key)$/i.test(
            name,
          ),
      ),
    ),
  };
}

export type OfflineStatus = {
  entries: OutboxEntry[];
  online: boolean;
  syncing: boolean;
  error: string;
  downloadedAt?: number;
  cachedAt?: number;
  quarantine?: z.infer<typeof Journal>["quarantine"];
};
export type OfflineBooks = ReturnType<typeof createOfflineBooks>;
export function createOfflineBooks(deps: {
  scope: OfflineScope;
  store: OfflineStore;
  transport: Transport;
  newId(): string;
  assertActive(): void;
  verifyAccess(): Promise<void>;
  confirmed?(entry: OutboxEntry): Promise<void>;
  now?: () => number;
  beforeExecute?(entry: OutboxEntry): Promise<void>;
  recoveryEpoch?: () => string | undefined;
}) {
  const { scope, store, assertActive } = deps;
  const now = deps.now ?? Date.now;
  const currentEpoch = deps.recoveryEpoch ?? serverRecovery.current;
  const journalKey = offlineKey(scope, "outbox"),
    cacheKey = offlineKey(scope, "reads");
  const listeners = new Set<() => void>();
  let revoked = false;
  let capturing = false;
  /** Answers received during a download, written to the cache once at the end. */
  let captured = new Map<string, { at: number; response: unknown }>();
  let batchRead: ((path: string) => Promise<unknown>) | undefined;
  let syncing: Promise<void> | undefined;
  let status: OfflineStatus = {
    entries: [],
    online: true,
    syncing: false,
    error: "",
  };
  const notify = (patch: Partial<OfflineStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((fn) => fn());
  };
  const active = () => {
    assertActive();
    if (revoked)
      throw new Error(
        "Offline access was revoked. Verify this firm's current membership online.",
      );
  };
  async function journal() {
    active();
    const saved = await store.get(journalKey);
    const result: z.infer<typeof Journal> = saved
      ? Journal.parse(JSON.parse(saved))
      : { version: 1 as const, scope, entries: [] };
    if (JSON.stringify(result.scope) !== JSON.stringify(scope))
      throw new Error(
        "The offline journal belongs to a different account, firm or role.",
      );
    active();
    return associatePayloadForRead(scope.role, result);
  }
  async function save(value: z.infer<typeof Journal>) {
    // Preserve a confirmed response under its original owner even if logout happened in flight.
    await store.set(journalKey, JSON.stringify(value));
    try {
      active();
      notify({
        entries: immutable(value.entries),
        quarantine: value.quarantine,
      });
    } catch {
      /* Original scope stays retained, never displayed in the new scope. */
    }
  }
  async function cached() {
    active();
    const value = await store.get(cacheKey);
    active();
    const parsed = value ? ReadCache.parse(JSON.parse(value)) : undefined;
    if (
      parsed &&
      (!currentEpoch() || parsed.recoveryEpoch !== currentEpoch())
    ) {
      await store.remove(cacheKey);
      notify({ cachedAt: undefined, downloadedAt: undefined });
      return { reads: {}, recoveryEpoch: currentEpoch() };
    }
    return parsed
      ? associatePayloadForRead(scope.role, parsed)
      : { reads: {}, recoveryEpoch: currentEpoch() };
  }
  async function bindEpoch(value: z.infer<typeof Journal>) {
    const epoch = currentEpoch();
    if (!epoch) throw recoveryRequired();
    if (!value.recoveryEpoch && !value.entries.length)
      value.recoveryEpoch = epoch;
    const unreviewed = value.entries.some(
      (entry) =>
        entry.recoveryEpoch !== epoch && entry.recoveryReview?.epoch !== epoch,
    );
    if (value.recoveryEpoch !== epoch || value.quarantine || unreviewed) {
      value.quarantine = {
        previous: value.recoveryEpoch,
        current: epoch,
        detectedAt: value.quarantine?.detectedAt ?? now(),
      };
      await save(value);
      notify({ error: recoveryMessage });
      throw recoveryRequired();
    }
    return epoch;
  }
  async function revoke() {
    revoked = true;
    await store.lock(cacheKey, () => store.remove(cacheKey));
    notify({
      entries: [],
      error:
        "Access changed. Retained requests are hidden until the original scope is authorized again.",
      downloadedAt: undefined,
      cachedAt: undefined,
    });
  }
  async function verify(checkRecovery = true) {
    assertActive();
    try {
      await deps.verifyAccess();
      revoked = false;
      active();
      if (checkRecovery)
        await store.lock(journalKey, async () => {
          const value = await journal();
          await bindEpoch(value);
          await save(value);
        });
    } catch (error) {
      if ([401, 403].includes((error as { status?: number }).status ?? -1))
        await revoke();
      throw error;
    }
  }
  async function load() {
    try {
      active();
      const value = await store.lock(journalKey, journal);
      const reads = await store.lock(cacheKey, cached);
      active();
      notify({
        entries: immutable(value.entries),
        downloadedAt: reads.downloadedAt,
        quarantine: value.quarantine,
      });
    } catch (error) {
      notify({ error: errorText(error) });
      throw error;
    }
  }
  async function enqueue(
    key: string,
    request: OperationInput,
    attachmentDraft = false,
    pendingStorageKey?: string,
  ) {
    return store.lock(journalKey, async () => {
      const value = await journal();
      const recoveryEpoch = await bindEpoch(value);
      const normalized = immutable(validateOperation(request));
      if (normalized.role !== scope.role)
        throw new Error("The original role changed.");
      const found = value.entries.find((entry) => entry.key === key);
      if (found) {
        if (found.recoveryEpoch !== recoveryEpoch) throw recoveryRequired();
        if (requestIdentity(found.request) !== requestIdentity(normalized))
          throw new Error(
            "The original request key cannot be reused for edited values.",
          );
        return found.key;
      }
      const equivalent = value.entries.find(
        (entry) =>
          !terminal(entry) &&
          requestIdentity(entry.request) === requestIdentity(normalized),
      );
      if (equivalent)
        throw new PendingOperationError(
          equivalent.key,
          "An identical request is already retained. Review its original key in Offline books before saving another entry.",
        );
      if (value.entries.filter((entry) => !terminal(entry)).length >= 1000)
        throw new Error("Sync or resolve pending entries before adding more.");
      value.entries.push({
        key,
        request: normalized,
        createdAt: now(),
        state: "queued",
        recoveryEpoch,
        ...(attachmentDraft ? { attachmentDraft: true } : {}),
        ...(pendingStorageKey ? { pendingStorageKey } : {}),
      });
      active();
      await save(value);
      return key;
    });
  }
  /** Writes a definite server answer onto the entry and reports it. */
  const executeNow = async (
    value: z.infer<typeof Journal>,
    entry: OutboxEntry,
  ) => {
    await deps.beforeExecute?.(immutable(entry));
    active();
    entry.state = "sending";
    entry.firstAttemptAt ??= now();
    await save(value);
    try {
      return await request(entry, "");
    } catch (error) {
      entry.state =
        (error as { code?: string }).code === RECOVERY_REQUIRED ||
        networkFailure(error) ||
        ((error as { status?: number }).status ?? 500) >= 500
          ? "unknown"
          : "blocked";
      entry.error = errorText(error);
      await save(value);
      if ((error as { code?: string }).code === RECOVERY_REQUIRED)
        await bindEpoch(value);
      throw error;
    }
  };
  /**
   * Offline the books are view-only, so a save goes to the server at once.
   * Reaching the server (the original-key lookup) is the online check: when it
   * fails, nothing is kept and the caller is told to connect. Only a save that
   * reached the server but lost its reply stays retained under its key, and it
   * is never sent again by itself.
   */
  async function saveNow(
    key: string,
    input: OperationInput,
    attachmentDraft = false,
    pendingStorageKey?: string,
  ) {
    return store.lock(journalKey, async () => {
      const value = await journal();
      const recoveryEpoch = await bindEpoch(value);
      const normalized = immutable(validateOperation(input));
      if (normalized.role !== scope.role)
        throw new Error("The original role changed.");
      const found = value.entries.find((entry) => entry.key === key);
      if (found) {
        if (found.recoveryEpoch !== recoveryEpoch) throw recoveryRequired();
        if (requestIdentity(found.request) !== requestIdentity(normalized))
          throw new Error(
            "The original request key cannot be reused for edited values.",
          );
        if (terminal(found) || ["conflict", "blocked"].includes(found.state))
          return found;
      } else {
        const equivalent = value.entries.find(
          (entry) =>
            !terminal(entry) &&
            requestIdentity(entry.request) === requestIdentity(normalized),
        );
        if (equivalent)
          throw new PendingOperationError(
            equivalent.key,
            "An identical entry is already retained. Review it in Offline books before saving another one.",
          );
        if (value.entries.filter((entry) => !terminal(entry)).length >= 1000)
          throw new Error("Resolve retained entries before adding more.");
      }
      const entry: OutboxEntry = found ?? {
        key,
        request: normalized,
        createdAt: now(),
        state: "queued",
        recoveryEpoch,
        ...(attachmentDraft ? { attachmentDraft: true } : {}),
        ...(pendingStorageKey ? { pendingStorageKey } : {}),
      };
      let result;
      try {
        result = await request(entry, "/lookup");
      } catch (error) {
        if (networkFailure(error)) {
          notify({ online: false });
          throw new OfflineWriteError();
        }
        throw error;
      }
      if (!found) value.entries.push(entry);
      if (result.state === "absent") result = await executeNow(value, entry);
      // A server restore during the save: its answer can't be confirmed as current.
      if (entry.recoveryEpoch !== currentEpoch()) {
        entry.state = "unknown";
        entry.error = recoveryMessage;
        await save(value);
        await bindEpoch(value);
        throw recoveryRequired();
      }
      accept(entry, result);
      await save(value);
      active();
      notify({ online: true });
      return immutable(entry);
    });
  }
  const request = async (entry: OutboxEntry, suffix: string) => {
    active();
    if (!entry.recoveryEpoch || entry.recoveryEpoch !== currentEpoch())
      throw recoveryRequired();
    return associatePayloadForRead(
      scope.role,
      validatedResult(
        entry.request,
        await deps.transport(
          `/v1/operations/${encodeURIComponent(entry.key)}${suffix}`,
          {
            method: "POST",
            headers: {
              "x-firm-id": scope.firmId,
              [RECOVERY_EPOCH_HEADER]: entry.recoveryEpoch,
            },
            body: entry.request,
          },
        ),
      ),
    );
  };
  const accept = (
    entry: OutboxEntry,
    result: z.infer<typeof OperationResult>,
  ) => {
    entry.result = result;
    if (result.state !== "absent") entry.state = result.state;
    entry.error =
      result.state === "conflict" || result.state === "unknown"
        ? result.message
        : undefined;
  };
  async function finish(entry: OutboxEntry) {
    if (entry.state !== "committed" && entry.state !== "cancelled") return;
    if (entry.recoveryEpoch !== currentEpoch()) return;
    active();
    try {
      await deps.confirmed?.(immutable(entry));
    } catch (error) {
      entry.error = `Entry saved. Attachment recovery: ${errorText(error)}`;
    }
  }
  async function synchronize(finishAttachments: boolean) {
    active();
    notify({ syncing: true, error: "" });
    try {
      await verify();
      await store.lock(journalKey, async () => {
        const value = await journal();
        // Offline is view-only: background sync only asks for original answers.
        // An entry the server never saved stays for the user to save or discard.
        for (const entry of value.entries) {
          active();
          if (terminal(entry) || ["conflict", "blocked"].includes(entry.state))
            continue;
          try {
            const result = await request(entry, "/lookup");
            if (entry.recoveryEpoch !== currentEpoch())
              throw recoveryRequired();
            if (result.state === "absent")
              entry.error =
                "Not saved. Open it in Offline books to save it now or discard it.";
            else accept(entry, result);
            await save(value);
            active();
            notify({ online: true });
          } catch (error) {
            if (entry.state !== "committed") {
              entry.state =
                (error as { code?: string }).code === RECOVERY_REQUIRED ||
                networkFailure(error) ||
                ((error as { status?: number }).status ?? 500) >= 500
                  ? entry.firstAttemptAt
                    ? "unknown"
                    : "queued"
                  : "blocked";
              entry.error = errorText(error);
              await save(value);
              if ((error as { code?: string }).code === RECOVERY_REQUIRED)
                await bindEpoch(value);
            }
            if (
              [401, 403].includes((error as { status?: number }).status ?? -1)
            )
              await revoke();
            throw error;
          }
        }
        await save(value);
      });
      // Attachment binding takes draft locks. Never hold the outbox lock while doing
      // it: an open financial form holds its draft lock before entering this journal.
      if (finishAttachments) {
        const entries = (await store.lock(journalKey, journal)).entries.filter(
          terminal,
        );
        for (const entry of entries) {
          await finish(entry);
          if (entry.error)
            await store.lock(journalKey, async () => {
              const value = await journal(),
                saved = value.entries.find((item) => item.key === entry.key);
              if (saved) saved.error = entry.error;
              await save(value);
            });
        }
      }
    } catch (error) {
      try {
        active();
        notify({ online: !networkFailure(error), error: errorText(error) });
      } catch {
        /* Scope already hidden. */
      }
      throw error;
    } finally {
      try {
        active();
        notify({ syncing: false });
      } catch {
        /* Inactive view cannot be updated. */
      }
    }
  }
  async function sync(finishAttachments = true) {
    // Forms hold a draft lock, so they must not await a sync's attachment callbacks.
    if (!finishAttachments) return synchronize(false);
    if (syncing) return syncing;
    syncing = synchronize(true).finally(() => {
      syncing = undefined;
    });
    return syncing;
  }
  async function reconcile(key: string, cancel = false) {
    await verify();
    const entry = await store.lock(journalKey, async () => {
      const value = await journal(),
        entry = value.entries.find((item) => item.key === key);
      if (!entry || terminal(entry)) return;
      let result = await request(entry, cancel ? "/cancel" : "/lookup");
      // The user asked to check it while online, so an unsaved original is sent now.
      if (result.state === "absent") result = await executeNow(value, entry);
      accept(entry, result);
      await save(value);
      return immutable(entry);
    });
    if (entry) await finish(entry);
  }
  async function replace(
    key: string,
    body: Record<string, unknown>,
    expectedVersion?: number,
  ) {
    active();
    return store
      .lock(journalKey, async () => {
        const value = await journal(),
          index = value.entries.findIndex((item) => item.key === key),
          old = value.entries[index];
        const recoveryEpoch = await bindEpoch(value);
        if (
          !old ||
          old.state !== "conflict" ||
          old.result?.state !== "conflict"
        )
          throw new Error(
            "Only a definitively rejected operation can be replaced. Resolve its original answer first.",
          );
        const request = immutable(
          validateOperation({
            ...old.request,
            body,
            expectedVersion,
            legacy: false,
          }),
        );
        const replacement = {
          key: deps.newId(),
          sourceKey: old.sourceKey ?? old.key,
          attachmentDraft: old.attachmentDraft,
          pendingStorageKey: old.pendingStorageKey,
          request,
          createdAt: now(),
          state: "queued" as const,
          recoveryEpoch,
        };
        old.state = "superseded";
        old.replacedBy = replacement.key;
        value.entries.splice(index + 1, 0, replacement);
        active();
        await save(value);
        return replacement.key;
      })
      .then(async (replacementKey) => {
        // Replacing is an online user action; it is sent now, never by background sync.
        await reconcile(replacementKey);
        return replacementKey;
      });
  }
  async function dismissConflict(key: string) {
    const dismissed = await store.lock(journalKey, async () => {
      const value = await journal(),
        entry = value.entries.find((item) => item.key === key);
      await bindEpoch(value);
      if (entry?.state !== "conflict" || entry.result?.state !== "conflict")
        throw new Error("The original result is not a confirmed rejection.");
      entry.state = "cancelled";
      await save(value);
      return immutable(entry);
    });
    await finish(dismissed);
  }
  async function clearReads() {
    active();
    await store.lock(cacheKey, () => store.remove(cacheKey));
    notify({ downloadedAt: undefined, cachedAt: undefined });
  }
  async function downloaded() {
    active();
    await store.lock(cacheKey, async () => {
      const value = await cached();
      value.downloadedAt = now();
      active();
      await store.set(cacheKey, JSON.stringify(value));
      notify({ downloadedAt: value.downloadedAt });
    });
  }
  /**
   * Reads issued together during a download go to the server as one batch of up
   * to 200. Each answer is exactly what its own route returns. A server without
   * batches (404) gets the reads one by one, as before.
   */
  function createBatchRead() {
    const queue: {
      path: string;
      resolve(value: unknown): void;
      reject(error: unknown): void;
    }[] = [];
    let scheduled = false;
    let supported = true;
    const one = (path: string) =>
      deps.transport(path, { headers: { "x-firm-id": scope.firmId } });
    const flush = async () => {
      scheduled = false;
      const group = queue.splice(0, MAX_BATCH_READS);
      if (queue.length) {
        scheduled = true;
        setTimeout(flush, 0);
      }
      if (!group.length) return;
      if (!supported) {
        for (const item of group)
          one(item.path).then(item.resolve, item.reject);
        return;
      }
      try {
        const { results } = BatchReadResult.parse(
          await deps.transport("/v1/reads/batch", {
            method: "POST",
            body: { paths: group.map((item) => item.path) },
            headers: { "x-firm-id": scope.firmId },
          }),
        );
        group.forEach((item, index) => {
          const result = results[index];
          if (!result || result.path !== item.path)
            return item.reject(
              new Error("The batch answer did not match its reads."),
            );
          if (result.status >= 200 && result.status < 300)
            return item.resolve(result.body);
          const error = (
            result.body as { error?: { code?: string; message?: string } }
          )?.error;
          // An older server batches fewer paths: read that one on its own.
          if (error?.code === "NOT_BATCHABLE")
            return void one(item.path).then(item.resolve, item.reject);
          item.reject(
            new ApiFailure(
              result.status,
              error?.code ?? "ERROR",
              error?.message ?? "Something went wrong. Please try again.",
              (result.body ?? {}) as Record<string, unknown>,
            ),
          );
        });
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          supported = false;
          for (const item of group)
            one(item.path).then(item.resolve, item.reject);
        } else for (const item of group) item.reject(error);
      }
    };
    return (path: string) =>
      new Promise<unknown>((resolve, reject) => {
        queue.push({ path, resolve, reject });
        if (!scheduled) {
          scheduled = true;
          setTimeout(flush, 0);
        }
      });
  }
  async function writeCaptured() {
    if (!captured.size) return;
    await store.lock(cacheKey, async () => {
      const value = await cached();
      for (const [key, entry] of captured) value.reads[key] = entry;
      const encoded = JSON.stringify(value);
      if (new TextEncoder().encode(encoded).byteLength > 25 * 1024 * 1024)
        throw new Error(
          "Offline read cache reached 25 MB. Clear downloaded books before refreshing it.",
        );
      active();
      await store.set(cacheKey, encoded);
    });
  }
  async function capture(work: () => Promise<void>) {
    if (capturing) throw new Error("A download is already in progress.");
    await verify();
    capturing = true;
    captured = new Map();
    batchRead = createBatchRead();
    try {
      await work();
      // One encrypted write for the whole download instead of one per answer.
      await writeCaptured();
      await downloaded();
    } finally {
      capturing = false;
      batchRead = undefined;
      captured = new Map();
    }
  }
  async function lookupOriginal(key: string, input: OperationInput) {
    await verify(false);
    const epoch = currentEpoch();
    if (!epoch) throw recoveryRequired();
    const result = await deps.transport(
      `/v1/operations/${encodeURIComponent(key)}/lookup`,
      {
        method: "POST",
        headers: { "x-firm-id": scope.firmId, [RECOVERY_EPOCH_HEADER]: epoch },
        body: input,
      },
    );
    active();
    if (epoch !== currentEpoch()) throw recoveryRequired();
    const answer = associatePayloadForRead(
      scope.role,
      validatedResult(input, result),
    );
    if (answer.state === "committed")
      await verifyRecoveredRows(input, answer.response, epoch);
    return answer;
  }
  async function verifyRecoveredRows(
    input: OperationInput,
    response: unknown,
    epoch: string,
  ) {
    const rows = Array.isArray(response) ? response : [response];
    for (const row of rows) {
      const id = (row as { id?: string } | null)?.id;
      if (!id)
        throw new Error(
          "The saved answer has no record identity. Keep it for manual reconciliation.",
        );
      const category = input.path.split("/")[1];
      const path =
        category === "accounts"
          ? "/v1/accounts/masters"
          : ["parties", "items", "ledgers"].includes(category)
            ? `/v1/${category}/${encodeURIComponent(id)}`
            : `/v1/vouchers/${encodeURIComponent(id)}`;
      const live = await deps.transport(path, {
        headers: { "x-firm-id": scope.firmId, [RECOVERY_EPOCH_HEADER]: epoch },
      });
      const candidates = Array.isArray(live)
        ? live
        : [live, ...Object.values((live ?? {}) as Record<string, unknown>)];
      if (
        !candidates.some(
          (value) =>
            value &&
            typeof value === "object" &&
            (value as { id?: string }).id === id,
        )
      )
        throw new Error(
          "The original answer has no matching restored record. Keep the request and files for manual reconciliation.",
        );
      if (epoch !== currentEpoch()) throw recoveryRequired();
    }
  }
  async function inspectRecovery(key: string) {
    const entry = (await store.lock(journalKey, journal)).entries.find(
      (row) => row.key === key,
    );
    if (!entry) throw new Error("The retained request was not found.");
    const result = await lookupOriginal(key, entry.request);
    const epoch = currentEpoch()!;
    await store.lock(journalKey, async () => {
      const value = await journal(),
        saved = value.entries.find((row) => row.key === key);
      if (!saved || epoch !== currentEpoch()) throw recoveryRequired();
      saved.recoveryLookup = { epoch, result };
      await save(value);
    });
  }
  async function reviewRecovery(key: string, note: string) {
    if (note.trim().length < 10)
      throw new Error(
        "Record what you checked and how any missing entry will be reconciled (at least 10 characters).",
      );
    await verify(false);
    await store.lock(journalKey, async () => {
      const value = await journal(),
        entry = value.entries.find((row) => row.key === key),
        epoch = currentEpoch();
      if (
        !value.quarantine ||
        !entry ||
        !epoch ||
        entry.recoveryLookup?.epoch !== epoch
      )
        throw new Error(
          "Check this original answer against the restored server first.",
        );
      // Review never posts an absent request, changes its identity, or replaces a known local success.
      if (!terminal(entry)) entry.state = "retained";
      entry.recoveryReview = { epoch, note: note.trim(), at: now() };
      await save(value);
    });
  }
  async function finishRecovery() {
    await verify(false);
    await store.lock(journalKey, async () => {
      const value = await journal(),
        epoch = currentEpoch();
      if (!epoch || !value.quarantine) throw recoveryRequired();
      if (value.entries.some((entry) => entry.recoveryReview?.epoch !== epoch))
        throw new Error(
          "Review every retained request, including completed history, before resuming new work.",
        );
      value.recoveryEpoch = epoch;
      value.quarantine = undefined;
      await save(value);
      notify({ error: "" });
    });
    await clearReads();
  }
  const transport: Transport = async (path, options = {}) => {
    active();
    const method = options.method ?? (options.body ? "POST" : "GET");
    const operationPath = path.replace(/^\/v1/, "");
    if (options.body && offlineDefinition(method, operationPath)) {
      const key = options.headers?.["idempotency-key"];
      if (!key || options.headers?.["x-firm-id"] !== scope.firmId)
        throw new Error(
          "A scoped stable request key is required before queuing an entry.",
        );
      let entry: OutboxEntry;
      try {
        entry = await saveNow(
          key,
          {
            method: method as "POST" | "PUT",
            path: operationPath,
            body: options.body as Record<string, unknown>,
            role: scope.role,
            ...(options.headers?.["x-hisaab-legacy-operation"] === "true"
              ? { legacy: true }
              : {}),
            ...(options.headers?.["if-match"]
              ? { expectedVersion: Number(options.headers["if-match"]) }
              : {}),
          },
          options.headers?.["x-hisaab-attachment-draft"] === "true",
          options.headers?.["x-hisaab-pending-key"],
        );
      } catch (error) {
        if (
          error instanceof OfflineWriteError ||
          error instanceof PendingOperationError
        )
          throw error;
        // The save reached the server but its reply was lost: keep it, never resend it.
        if (
          networkFailure(error) ||
          ((error as { status?: number }).status ?? 0) >= 500
        )
          throw new PendingOperationError(key);
        throw error;
      }
      if (entry.result?.state === "committed") return entry.result.response;
      throw new PendingOperationError(
        key,
        entry.error
          ? `${entry.error} The original request is kept in Offline books; it has not been reported as saved.`
          : undefined,
      );
    }
    if (!["GET", "HEAD"].includes(method))
      await store.lock(journalKey, async () => {
        const value = await journal();
        await bindEpoch(value);
        await save(value);
      });
    try {
      const batched =
        batchRead &&
        method === "GET" &&
        cacheable(path) &&
        (options.headers?.["x-firm-id"] ?? scope.firmId) === scope.firmId;
      const response = associatePayloadForRead(
        scope.role,
        batched
          ? await batchRead!(path)
          : await deps.transport(path, withoutOfflineHints(options)),
      );
      const validated = options.validate
        ? options.validate(response)
        : response;
      active();
      notify({ online: true });
      if (method === "GET" && cacheable(path) && capturing) {
        captured.set(readKey(path), { at: now(), response: validated });
      } else if (method === "GET" && cacheable(path)) {
        try {
          await store.lock(cacheKey, async () => {
            const value = await cached();
            value.reads[readKey(path)] = { at: now(), response: validated };
            const encoded = JSON.stringify(value);
            if (new TextEncoder().encode(encoded).byteLength > 25 * 1024 * 1024)
              throw new Error(
                "Offline read cache reached 25 MB. Clear downloaded books before refreshing it.",
              );
            active();
            await store.set(cacheKey, encoded);
          });
        } catch (error) {
          active();
          notify({
            error: `Online result received, but offline copy was not updated: ${errorText(error)}`,
          });
          if (capturing) throw error;
        }
      }
      return response;
    } catch (error) {
      active();
      if ((error as { status?: number }).status === 401) await revoke();
      if ((error as { status?: number }).status === 403) {
        try {
          await verify();
        } catch {
          await revoke();
        }
      }
      if (networkFailure(error) && !["GET", "HEAD"].includes(method)) {
        notify({ online: false });
        throw new OfflineWriteError();
      }
      if (
        !capturing &&
        networkFailure(error) &&
        method === "GET" &&
        cacheable(path)
      ) {
        const entry = (await store.lock(cacheKey, cached)).reads[readKey(path)];
        notify({ online: false, cachedAt: entry?.at });
        if (entry) {
          active();
          return options.validate
            ? options.validate(entry.response)
            : entry.response;
        }
      }
      throw error;
    }
  };
  return {
    scope,
    transport,
    enqueue,
    saveNow,
    sync,
    load,
    reconcile,
    replace,
    dismissConflict,
    clearReads,
    capture,
    revoke,
    lookupOriginal,
    inspectRecovery,
    reviewRecovery,
    finishRecovery,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => status,
  };
}

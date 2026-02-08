import { z } from "zod";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import type { RequestOptions, Transport } from "./client";
import type { OfflineStore } from "./offlineStore.types";
import {
  OfflineScope,
  OperationInput,
  OperationResult,
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
  ]),
  firstAttemptAt: z.number().optional(),
  result: OperationResult.optional(),
  error: z.string().optional(),
  replacedBy: z.string().optional(),
  sourceKey: z.string().optional(),
  attachmentDraft: z.boolean().optional(),
  pendingStorageKey: z.string().optional(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;
const Journal = z.object({
  version: z.literal(1),
  scope: OfflineScope,
  entries: z.array(OutboxEntry),
});
const ReadCache = z.object({
  reads: z.record(
    z.string(),
    z.object({ at: z.number(), response: z.unknown() }),
  ),
  downloadedAt: z.number().optional(),
});
const terminal = (entry: OutboxEntry) =>
  ["committed", "cancelled", "superseded"].includes(entry.state);
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not be synchronized.";
const readKey = (path: string) => {
  const url = new URL(path, "https://local.invalid");
  url.searchParams.sort();
  return url.pathname + url.search;
};
const cacheable = (path: string) =>
  /^\/v1\/(parties|items|ledgers|vouchers|reports|accounts|units|gst|inventory)(\/|\?|$)/.test(
    path,
  ) || /^\/v1\/(firms\/current|settings\/invoice)(\?|$)/.test(path);

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
}) {
  const { scope, store, assertActive } = deps;
  const now = deps.now ?? Date.now;
  const journalKey = offlineKey(scope, "outbox"),
    cacheKey = offlineKey(scope, "reads");
  const listeners = new Set<() => void>();
  let revoked = false;
  let capturing = false;
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
    const result = saved
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
      notify({ entries: immutable(value.entries) });
    } catch {
      /* Original scope stays retained, never displayed in the new scope. */
    }
  }
  async function cached() {
    active();
    const value = await store.get(cacheKey);
    active();
    return value
      ? associatePayloadForRead(scope.role, ReadCache.parse(JSON.parse(value)))
      : { reads: {} };
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
  async function verify() {
    assertActive();
    try {
      await deps.verifyAccess();
      revoked = false;
      active();
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
      const normalized = immutable(validateOperation(request));
      if (normalized.role !== scope.role)
        throw new Error("The original role changed.");
      const found = value.entries.find((entry) => entry.key === key);
      if (found) {
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
        ...(attachmentDraft ? { attachmentDraft: true } : {}),
        ...(pendingStorageKey ? { pendingStorageKey } : {}),
      });
      active();
      await save(value);
      return key;
    });
  }
  const request = async (entry: OutboxEntry, suffix: string) => {
    active();
    return associatePayloadForRead(
      scope.role,
      validatedResult(
        entry.request,
        await deps.transport(
          `/v1/operations/${encodeURIComponent(entry.key)}${suffix}`,
          {
            method: "POST",
            headers: { "x-firm-id": scope.firmId },
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
        for (const entry of value.entries) {
          active();
          if (terminal(entry)) continue;
          if (["conflict", "blocked"].includes(entry.state)) break;
          try {
            let result = await request(entry, "/lookup");
            if (result.state === "absent") {
              await deps.beforeExecute?.(immutable(entry));
              active();
              entry.state = "sending";
              entry.firstAttemptAt ??= now();
              await save(value);
              result = await request(entry, "");
            }
            accept(entry, result);
            await save(value);
            active();
            notify({ online: true });
            if (!terminal(entry)) break;
          } catch (error) {
            if (entry.state !== "committed") {
              entry.state =
                networkFailure(error) ||
                ((error as { status?: number }).status ?? 500) >= 500
                  ? entry.firstAttemptAt
                    ? "unknown"
                    : "queued"
                  : "blocked";
              entry.error = errorText(error);
              await save(value);
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
      const result = await request(entry, cancel ? "/cancel" : "/lookup");
      if (result.state === "absent") {
        entry.state = "queued";
        entry.error = undefined;
      } else accept(entry, result);
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
    return store.lock(journalKey, async () => {
      const value = await journal(),
        index = value.entries.findIndex((item) => item.key === key),
        old = value.entries[index];
      if (!old || old.state !== "conflict" || old.result?.state !== "conflict")
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
      };
      old.state = "superseded";
      old.replacedBy = replacement.key;
      value.entries.splice(index + 1, 0, replacement);
      active();
      await save(value);
      return replacement.key;
    });
  }
  async function dismissConflict(key: string) {
    const dismissed = await store.lock(journalKey, async () => {
      const value = await journal(),
        entry = value.entries.find((item) => item.key === key);
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
  async function capture(work: () => Promise<void>) {
    if (capturing) throw new Error("A download is already in progress.");
    await verify();
    capturing = true;
    try {
      await work();
      await downloaded();
    } finally {
      capturing = false;
    }
  }
  async function lookupOriginal(key: string, input: OperationInput) {
    await verify();
    const result = await deps.transport(
      `/v1/operations/${encodeURIComponent(key)}/lookup`,
      {
        method: "POST",
        headers: { "x-firm-id": scope.firmId },
        body: input,
      },
    );
    active();
    return associatePayloadForRead(scope.role, validatedResult(input, result));
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
      const id = await enqueue(
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
      try {
        await sync(false);
      } catch {
        active(); /* Persisted entry and original result are examined below. */
      }
      const entry = (await store.lock(journalKey, journal)).entries.find(
        (value) => value.key === id,
      )!;
      if (entry.result?.state === "committed") return entry.result.response;
      throw new PendingOperationError(
        id,
        entry.error
          ? `${entry.error} Original request retained in Offline books; it has not been reported as saved.`
          : undefined,
      );
    }
    try {
      const response = associatePayloadForRead(
        scope.role,
        await deps.transport(path, withoutOfflineHints(options)),
      );
      const validated = options.validate
        ? options.validate(response)
        : response;
      active();
      notify({ online: true });
      if (method === "GET" && cacheable(path)) {
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
    sync,
    load,
    reconcile,
    replace,
    dismissConflict,
    clearReads,
    capture,
    revoke,
    lookupOriginal,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => status,
  };
}

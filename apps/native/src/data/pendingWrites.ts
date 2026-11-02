import type { Transport } from "./client";
import {
  isDurableRequestId,
  newRequestId,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import {
  serverRecovery,
  assertRecoveryEpoch,
  recoveryRequired,
} from "./recoveryEpoch";

export interface PendingWriteLifecycle {
  key: string;
  userId: string;
  firmId: string;
  path: string;
  legacy?: boolean;
  recoveryEpoch?: string;
  previouslyAttempted?: boolean;
  assertActive(): void;
  beforeSend(): Promise<void>;
  afterValidatedResponse(response: unknown): Promise<void>;
}
const lifecycles = new WeakMap<object, PendingWriteLifecycle>();
export function bindPendingWrite<T extends object>(
  body: T,
  lifecycle: PendingWriteLifecycle,
): T {
  lifecycles.set(body, lifecycle);
  return body;
}
export function pendingWriteHeaders(body: object, path: string) {
  const lifecycle = lifecycles.get(body);
  if (!lifecycle) return undefined;
  lifecycle.assertActive();
  if (lifecycle.path !== path)
    throw new Error(
      "The saved financial operation belongs to a different request.",
    );
  return { "idempotency-key": lifecycle.key };
}
export class ConfirmedWriteError extends Error {
  constructor(
    readonly response: unknown,
    cause: unknown,
  ) {
    super(
      "Entry saved; its attachment binding could not be stored. Recover the original save in Pending uploads.",
      { cause },
    );
  }
}

export interface DataStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export async function releasePendingWrite(
  storage: DataStorage,
  storageKey: string | undefined,
  key: string,
) {
  if (!storageKey?.startsWith("hisaab.pending.")) return;
  if ((await storage.get(storageKey)) !== key) return;
  await storage.remove(storageKey);
  await storage.remove(`${storageKey}.protocol`);
  await storage.remove(`${storageKey}.epoch`);
}

/** Keep the same key after a lost reply, even if the app restarts before retrying. */
export function withPendingWrites(
  transport: Transport,
  storage: DataStorage,
  userId: string,
  hash: (text: string) => Promise<string>,
  newKey: () => string,
  durableOperations = false,
): Transport {
  const running = new Map<string, Promise<unknown>>();
  return async (path, options = {}) => {
    const method = options.method ?? (options.body ? "POST" : "GET");
    if (!["POST", "PUT"].includes(method) || !options.body)
      return transport(path, options);
    const lifecycle = lifecycles.get(options.body);
    lifecycle?.assertActive();
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    const explicitKey = headers["idempotency-key"] ?? lifecycle?.key;
    if (
      lifecycle &&
      (lifecycle.userId !== userId ||
        lifecycle.firmId !== headers["x-firm-id"] ||
        `/v1${lifecycle.path}` !== path ||
        explicitKey !== lifecycle.key)
    )
      throw new Error(
        "The financial attachment operation does not match this account, firm or request.",
      );
    const signature = await hash(
      JSON.stringify([
        userId,
        headers["x-firm-id"],
        path,
        options.body,
        ...(method === "POST" ? [] : [method, headers["if-match"]]),
        // Attachment records own their keys, even when two files have identical metadata.
        ...(explicitKey === undefined ? [] : [explicitKey]),
      ]),
    );
    const storageKey = `hisaab.pending.${signature}`;
    const existing = running.get(storageKey);
    if (existing) return existing;
    const send = async () => {
      const savedKey = await storage.get(storageKey);
      const epochKey = `${storageKey}.epoch`;
      const savedEpoch = await storage.get(epochKey);
      const recoveryEpoch =
        headers[RECOVERY_EPOCH_HEADER] ??
        lifecycle?.recoveryEpoch ??
        (savedKey ? savedEpoch : undefined) ??
        serverRecovery.current();
      if (
        (savedKey && !savedEpoch) ||
        (lifecycle?.previouslyAttempted && !lifecycle.recoveryEpoch)
      )
        throw recoveryRequired();
      assertRecoveryEpoch(recoveryEpoch);
      if (savedKey && savedEpoch && savedEpoch !== recoveryEpoch)
        throw recoveryRequired();
      const key = explicitKey ?? savedKey ?? newRequestId(newKey());
      const marker = `${storageKey}.protocol`;
      const legacy =
        durableOperations &&
        (lifecycle?.legacy === true ||
          (!explicitKey &&
            !!savedKey &&
            !isDurableRequestId(savedKey) &&
            (await storage.get(marker)) !== "operations-v1"));
      await storage.set(storageKey, key);
      await storage.set(epochKey, recoveryEpoch!);
      if (durableOperations && !legacy)
        await storage.set(marker, "operations-v1");
      try {
        await lifecycle?.beforeSend();
        lifecycle?.assertActive();
        const reply = await transport(path, {
          ...options,
          headers: {
            ...headers,
            "idempotency-key": key,
            [RECOVERY_EPOCH_HEADER]: recoveryEpoch!,
            ...(legacy ? { "x-hisaab-legacy-operation": "true" } : {}),
            ...(durableOperations && lifecycle
              ? { "x-hisaab-attachment-draft": "true" }
              : {}),
            ...(durableOperations
              ? { "x-hisaab-pending-key": storageKey }
              : {}),
          },
        });
        assertRecoveryEpoch(recoveryEpoch);
        // An unreadable success response is still an uncertain save and must retain its key.
        const validated = options.validate ? options.validate(reply) : reply;
        try {
          await lifecycle?.afterValidatedResponse(validated);
        } catch (error) {
          throw new ConfirmedWriteError(validated, error);
        }
        // A local storage failure must not turn a confirmed save into an apparent failed save.
        await storage.remove(storageKey).catch(() => {});
        await storage.remove(epochKey).catch(() => {});
        if (durableOperations) await storage.remove(marker).catch(() => {});
        return reply;
      } catch (error) {
        const status = (error as { status?: number }).status;
        const code = (error as { code?: string }).code;
        // Access and session failures do not prove that an earlier attempt failed.
        if (
          !lifecycle &&
          code !== "RETRY_RESULT_UNKNOWN" &&
          code !== "KEY_REUSED" &&
          (status === 400 || status === 422)
        ) {
          await storage.remove(storageKey).catch(() => {});
          await storage.remove(epochKey).catch(() => {});
        }
        throw error;
      }
    };
    const pending = send().finally(() => running.delete(storageKey));
    running.set(storageKey, pending);
    return pending;
  };
}

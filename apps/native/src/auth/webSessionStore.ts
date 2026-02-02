import { z } from "zod";
import type { OfflineStore } from "../data/offlineStore.types";
import { offlineAccessMaxAge } from "../data/offlineAccess";

const key = "web-session-v1";
const Record = z.object({
  generation: z.string(),
  loggedOut: z.boolean(),
  verifiedAt: z.number().finite().optional(),
  identity: z.unknown().optional(),
});
type SessionRecord = z.infer<typeof Record>;
export type SessionBroadcast = {
  publish(): void;
  subscribe(listener: () => void): void;
};

/** Persist identity, never credentials; a shared generation fences late responses from other tabs. */
export function createWebSessionStore(
  storage: OfflineStore,
  options: { now?: () => number; broadcast?: SessionBroadcast } = {},
) {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let generation: string | undefined;
  let revision = 0;
  let writes = Promise.resolve();
  const invalidate = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  options.broadcast?.subscribe(invalidate);
  const enqueue = (work: () => Promise<void>) => {
    const next = writes.then(() => storage.lock(key, work));
    writes = next.catch(() => {});
    return next;
  };
  async function read(): Promise<SessionRecord> {
    const value = await storage.get(key);
    if (value) return Record.parse(JSON.parse(value));
    const initial = { generation: crypto.randomUUID(), loggedOut: false };
    await storage.set(key, JSON.stringify(initial));
    return initial;
  }
  function matches(record: SessionRecord) {
    generation ??= record.generation;
    return generation === record.generation && !record.loggedOut;
  }
  return {
    get revision() {
      return revision;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // HttpOnly session cookies remain exclusively in the browser's cookie jar.
    readCookie: async (): Promise<string | null> => null,
    saveCookie: async (_value: string | null, _expected: number) => {},
    async canRefresh() {
      await writes;
      return storage.lock(key, async () => matches(await read()));
    },
    activate() {
      revision++;
      return enqueue(async () => {
        const record = { generation: crypto.randomUUID(), loggedOut: false };
        await storage.set(key, JSON.stringify(record));
        generation = record.generation;
        options.broadcast?.publish();
      });
    },
    saveIdentity(identity: unknown, expected: number) {
      return enqueue(async () => {
        const record = await read();
        if (expected !== revision || !matches(record)) return;
        await storage.set(
          key,
          JSON.stringify({ ...record, identity, verifiedAt: now() }),
        );
      });
    },
    async readIdentity(): Promise<unknown> {
      const expected = revision;
      await writes;
      return storage.lock(key, async () => {
        const record = await read();
        if (
          expected !== revision ||
          !matches(record) ||
          record.verifiedAt === undefined
        )
          return null;
        const age = now() - record.verifiedAt;
        return age >= 0 && age < offlineAccessMaxAge
          ? (record.identity ?? null)
          : null;
      });
    },
    clear() {
      invalidate();
      return enqueue(async () => {
        const record = { generation: crypto.randomUUID(), loggedOut: true };
        await storage.set(key, JSON.stringify(record));
        generation = record.generation;
        options.broadcast?.publish();
      });
    },
  };
}

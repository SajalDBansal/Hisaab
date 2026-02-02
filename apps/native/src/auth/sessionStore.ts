export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

const COOKIE_KEY = "hisaab.cookie";
const ME_KEY = "hisaab.me";

/** Serialize credential writes so an older response cannot undo a logout. */
export function createSessionStore(storage: SecretStore) {
  let revision = 0;
  const listeners = new Set<() => void>();
  let writes = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    const next = writes.then(work);
    writes = next.catch(() => {});
    return next;
  };
  const save = (key: string, value: string | null, expected: number) =>
    enqueue(async () => {
      if (expected !== revision) return;
      if (value === null) await storage.deleteSecret(key);
      else await storage.setSecret(key, value);
    });

  return {
    canRefresh: async () => true,
    activate: async () => {},
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get revision() {
      return revision;
    },
    async readCookie() {
      await writes;
      return storage.getSecret(COOKIE_KEY);
    },
    saveCookie: (value: string | null, expected: number) =>
      save(COOKIE_KEY, value, expected),
    saveIdentity: (value: unknown, expected: number) =>
      save(ME_KEY, JSON.stringify(value), expected),
    async readIdentity(): Promise<unknown> {
      const expected = revision;
      await writes;
      const [cookie, saved] = await Promise.all([
        storage.getSecret(COOKIE_KEY),
        storage.getSecret(ME_KEY),
      ]);
      if (expected !== revision || !cookie || !saved) return null;
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    },
    clear() {
      revision++;
      listeners.forEach((listener) => listener());
      return enqueue(async () => {
        await Promise.all([
          storage.deleteSecret(COOKIE_KEY),
          storage.deleteSecret(ME_KEY),
        ]);
      });
    },
  };
}

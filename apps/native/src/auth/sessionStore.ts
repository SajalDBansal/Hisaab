export interface SecretStore {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

const COOKIE_KEY = "hisaab.cookie";
const ME_KEY = "hisaab.me";
const LOGOUT_KEY = "hisaab.logout";

/** Serialize credential writes so an older response cannot undo a logout. */
export function createSessionStore(storage: SecretStore) {
  let revision = 0;
  let blocked = false;
  const listeners = new Set<() => void>();
  let writes = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    const next = writes.then(work);
    writes = next.catch(() => {});
    return next;
  };
  const save = (key: string, value: string | null, expected: number) =>
    enqueue(async () => {
      if (expected !== revision || blocked) return;
      if ((await storage.getSecret(LOGOUT_KEY)) !== null) return;
      if (value === null) await storage.deleteSecret(key);
      else await storage.setSecret(key, value);
    });

  return {
    async canRefresh() {
      await writes;
      return !blocked && (await storage.getSecret(LOGOUT_KEY)) === null;
    },
    // Called before a new native login, never as part of automatic restoration.
    activate() {
      const expected = ++revision;
      blocked = true;
      return enqueue(async () => {
        await storage.setSecret(LOGOUT_KEY, "1");
        await storage.deleteSecret(COOKIE_KEY);
        await storage.deleteSecret(ME_KEY);
        await storage.deleteSecret(LOGOUT_KEY);
        blocked = expected !== revision;
      });
    },
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
      if (blocked || (await storage.getSecret(LOGOUT_KEY)) !== null)
        return null;
      return storage.getSecret(COOKIE_KEY);
    },
    saveCookie: (value: string | null, expected: number) =>
      save(COOKIE_KEY, value, expected),
    saveIdentity: (value: unknown, expected: number) =>
      save(ME_KEY, JSON.stringify(value), expected),
    async readIdentity(): Promise<unknown> {
      const expected = revision;
      await writes;
      if (blocked || (await storage.getSecret(LOGOUT_KEY)) !== null)
        return null;
      const [cookie, saved] = await Promise.all([
        storage.getSecret(COOKIE_KEY),
        storage.getSecret(ME_KEY),
      ]);
      if (blocked || expected !== revision || !cookie || !saved) return null;
      return JSON.parse(saved);
    },
    clear() {
      revision++;
      blocked = true;
      listeners.forEach((listener) => listener());
      return enqueue(async () => {
        // The marker survives interruption and prevents reuse of either credential
        // or the separately encrypted cached identity on the next launch.
        await storage.setSecret(LOGOUT_KEY, "1");
        await storage.deleteSecret(COOKIE_KEY);
        await storage.deleteSecret(ME_KEY);
      });
    },
  };
}

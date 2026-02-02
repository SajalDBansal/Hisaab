import type { ReportPreferenceStorage } from "./reportPreferences";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Saved filters are unavailable in this browser."));
      return;
    }
    const request = indexedDB.open("hisaab-report-preferences-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("preferences");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other Hisaab tabs and retry saved filters."));
  });
}

async function transaction(
  key: string,
  transform?: (raw: string | null) => string,
) {
  const db = await database();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(
        "preferences",
        transform ? "readwrite" : "readonly",
        { durability: "strict" },
      );
      const store = tx.objectStore("preferences");
      const request = store.get(key);
      let result: string | null = null;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          if (
            request.result !== undefined &&
            typeof request.result !== "string"
          )
            throw new Error("Saved report filters are damaged.");
          result = request.result ?? null;
          if (transform) store.put(transform(result), key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error("Couldn't save report filters."),
        );
      tx.onerror = () => reject(tx.error ?? request.error);
    });
  } finally {
    db.close();
  }
}

export const reportPreferencesStorage: ReportPreferenceStorage = {
  read: (key) => transaction(key),
  async update(key, transform) {
    await transaction(key, transform);
  },
};

import type { OfflineStore } from "./offlineStore.types";

const encoder = new TextEncoder();
const storageUnavailable = (cause: unknown) =>
  new Error(
    "Encrypted browser storage is unavailable. Allow this site's storage and retry. Do not clear site data while entries are pending.",
    { cause },
  );
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open("hisaab-offline-sealed-v1", 1);
    } catch (error) {
      reject(storageUnavailable(error));
      return;
    }
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("sealed");
    request.onsuccess = () =>
      blocked ? request.result.close() : resolve(request.result);
    request.onerror = () => reject(storageUnavailable(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error("Close other Hisaab tabs before opening offline storage."),
      );
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("sealed", mode, { durability: "strict" });
      const request = work(tx.objectStore("sealed"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Offline storage transaction failed."));
      tx.onerror = () => reject(tx.error ?? request.error);
    });
  } catch (error) {
    throw storageUnavailable(error);
  } finally {
    db.close();
  }
}
const lock: OfflineStore["lock"] = (key, work) => {
  if (!globalThis.crypto?.subtle || !navigator.locks)
    return Promise.reject(
      new Error(
        "Encrypted offline storage requires Web Crypto and Web Locks in a secure browser.",
      ),
    );
  return navigator.locks.request(`offline:${key}`, work);
};
async function encryptionKey() {
  return lock("encryption-key", async () => {
    const existing = await transaction<CryptoKey | undefined>(
      "readonly",
      (store) => store.get("key"),
    );
    if (existing) {
      if (
        !(existing instanceof CryptoKey) ||
        existing.type !== "secret" ||
        existing.extractable ||
        existing.algorithm.name !== "AES-GCM"
      )
        throw new Error(
          "The offline encryption key cannot be opened. Use the original browser profile; do not clear site data while entries are pending.",
        );
      return existing;
    }
    // Non-extractable, origin-bound key. Same-origin scripts can still use it: this is not XSS protection.
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await transaction("readwrite", (store) => store.add(key, "key"));
    return key;
  });
}
const recordKey = async (key: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(key))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
export async function sealLocal(key: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(key) },
    await encryptionKey(),
    encoder.encode(value),
  );
  return JSON.stringify([base64(iv), base64(new Uint8Array(ciphertext))]);
}
export async function openLocal(key: string, value: string) {
  const [iv, ciphertext] = JSON.parse(value) as [string, string];
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unbase64(iv),
        additionalData: encoder.encode(key),
      },
      await encryptionKey(),
      unbase64(ciphertext),
    ),
  );
}
export const offlineStore: OfflineStore = {
  async get(key) {
    const id = await recordKey(key);
    const row = await transaction<
      { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer } | undefined
    >("readonly", (store) => store.get(id));
    return row
      ? new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: row.iv,
              additionalData: encoder.encode(key),
            },
            await encryptionKey(),
            row.ciphertext,
          ),
        )
      : null;
  },
  async set(key, value) {
    const id = await recordKey(key);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(key) },
      await encryptionKey(),
      encoder.encode(value),
    );
    await transaction("readwrite", (store) =>
      store.put({ iv, ciphertext }, id),
    );
  },
  async remove(key) {
    const id = await recordKey(key);
    await transaction("readwrite", (store) => store.delete(id));
  },
  lock,
};

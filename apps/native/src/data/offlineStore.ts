import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { attachmentLock } from "./attachmentRecovery";
import type { OfflineStore } from "./offlineStore.types";

const encoder = new TextEncoder();
function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function encryptionKey() {
  return attachmentLock("offline-encryption-key", async () => {
    const stored = await SecureStore.getItemAsync("hisaab.offline.key.v1");
    if (stored) return Crypto.AESEncryptionKey.import(stored, "base64");
    const key = await Crypto.AESEncryptionKey.generate();
    await SecureStore.setItemAsync(
      "hisaab.offline.key.v1",
      await key.encoded("base64"),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
    );
    return key;
  });
}
async function files(key: string) {
  const id = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    key,
  );
  const directory = new Directory(Paths.document, "offline-books-v1");
  return {
    directory,
    published: new File(directory, `${id}.sealed`),
    next: new File(directory, `${id}.next`),
  };
}
export async function sealLocal(key: string, value: string) {
  return (
    await Crypto.aesEncryptAsync(encoder.encode(value), await encryptionKey(), {
      additionalData: encoder.encode(key),
    })
  ).combined("base64");
}
export async function openLocal(key: string, value: string) {
  return new TextDecoder().decode(
    await Crypto.aesDecryptAsync(
      // Android requires bytes here despite Expo's base64 string overload.
      Crypto.AESSealedData.fromCombined(decodeBase64(value)),
      await encryptionKey(),
      { additionalData: encoder.encode(key) },
    ),
  );
}
export const offlineStore: OfflineStore = {
  async get(key) {
    const { published, next } = await files(key);
    const source = published.exists ? published : next;
    if (!source.exists) return null;
    return openLocal(key, await source.text());
  },
  async set(key, value) {
    const { directory, published, next } = await files(key);
    const sealed = await Crypto.aesEncryptAsync(
      encoder.encode(value),
      await encryptionKey(),
      { additionalData: encoder.encode(key) },
    );
    directory.create({ intermediates: true, idempotent: true });
    const temporary = new File(directory, next.name);
    if (!published.exists && next.exists) await next.move(published);
    temporary.write(await sealed.combined("base64"));
    await temporary.move(published, { overwrite: true });
  },
  async remove(key) {
    const { published, next } = await files(key);
    if (published.exists) published.delete();
    if (next.exists) next.delete();
  },
  lock: (key, work) => attachmentLock(`offline:${key}`, work),
};

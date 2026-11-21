import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { sqlReplicaStore, type SqlConnection } from "./sqlStore";

/** The phone keeps the books in its own SQLite database. */
export const replicaSupported = true;

const KEY_NAME = "hisaab.books.key.v1";

/** The database key: random, kept in the phone's secure storage, never sent anywhere. */
async function databaseKey() {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored) return stored;
  const key = Array.from(Crypto.getRandomBytes(32), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  await SecureStore.setItemAsync(KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

// The file is encrypted with SQLCipher (the expo-sqlite plugin in app.json).
export const replicaStore = sqlReplicaStore(async () => {
  const db = await SQLite.openDatabaseAsync("hisaab-books.db");
  await db.execAsync(
    `PRAGMA key = "x'${await databaseKey()}'"; PRAGMA journal_mode = WAL;`,
  );
  return db as unknown as SqlConnection;
});

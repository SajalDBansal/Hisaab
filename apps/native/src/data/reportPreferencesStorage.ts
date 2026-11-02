import { Directory, File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import {
  reportPreferenceLock,
  type ReportPreferenceStorage,
} from "./reportPreferences";

async function files(key: string) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    key,
  );
  const directory = new Directory(
    Paths.document,
    "report-preferences-v1",
    hash,
  );
  return {
    directory,
    published: new File(directory, "preferences.json"),
    next: new File(directory, "preferences.next"),
  };
}

async function read(key: string) {
  const { published, next } = await files(key);
  const source = published.exists ? published : next;
  return source.exists ? source.text() : null;
}

export const reportPreferencesStorage: ReportPreferenceStorage = {
  read: (key) => reportPreferenceLock(key, () => read(key)),
  update: (key, transform) =>
    reportPreferenceLock(key, async () => {
      const value = transform(await read(key));
      const { directory, published, next } = await files(key);
      directory.create({ intermediates: true, idempotent: true });
      // Recover an interrupted publish before replacing the staging file.
      if (!published.exists && next.exists) await next.move(published);
      const staging = new File(directory, "preferences.next");
      staging.write(value);
      await staging.move(published, { overwrite: true });
    }),
};

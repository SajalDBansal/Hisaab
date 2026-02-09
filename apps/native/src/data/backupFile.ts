/**
 * Phone: save a backup file through the share sheet (Drive, WhatsApp to yourself,
 * Files …) and pick one back for restore. The web version is backupFile.web.ts.
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function saveBackupFile(fileName: string, text: string) {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("Sharing isn't available on this phone.");
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    UTI: "public.json",
    dialogTitle: "Save backup",
  });
}

/** Open the file picker; null if the user cancels. */
export async function pickBackupFile(): Promise<string | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ["application/json", "application/octet-stream", "text/plain"],
  });
  if (picked.canceled) return null;
  return picked.result.text();
}

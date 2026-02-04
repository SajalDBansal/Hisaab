import { Directory, File, Paths } from "expo-file-system";
import { fetch } from "expo/fetch";
import * as Sharing from "expo-sharing";
import type { DocumentFile } from "@repo/core";

export async function uploadDocumentFile(url: string, file: DocumentFile) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.contentType },
    body: await new File(file.uri).arrayBuffer(),
  });
  if (!response.ok)
    throw new Error(
      "The file upload failed. Check your connection and try again.",
    );
}

// Downloads save to the user's chosen folder; sharing sends a temporary copy to another app.
export async function saveDocumentFile(
  url: string,
  name: string,
  share = false,
) {
  if (share && !(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  const directory = share ? undefined : await Directory.pickDirectoryAsync();
  const file = new File(
    Paths.cache,
    `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
  );
  try {
    await File.downloadFileAsync(url, file);
    if (directory) await file.copy(directory);
    else await Sharing.shareAsync(file.uri, { dialogTitle: name });
  } finally {
    if (file.exists) file.delete();
  }
}

export const localFileSize = (uri: string) => new File(uri).size;

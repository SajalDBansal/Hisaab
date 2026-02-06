import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import { MAX_IMPORT_BYTES } from "@repo/contracts/src/imports";

export async function pickImportFile(): Promise<{
  name: string;
  text: string;
} | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: [
      "text/csv",
      "text/comma-separated-values",
      "application/csv",
      "text/plain",
      "application/vnd.ms-excel",
    ],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset || !/\.csv$/i.test(asset.name))
    throw new Error("Choose a .csv file.");
  const file = new File(asset.uri);
  if (!file.exists || file.size < 1 || file.size > MAX_IMPORT_BYTES)
    throw new Error("Choose a CSV between 1 byte and 256 KiB.");
  const text = await file.text();
  return { name: asset.name, text };
}

export async function saveImportFile(fileName: string, text: string) {
  if (
    !/^hisaab-(customers|suppliers|items|opening-balances|open-bills|opening-stock)-(template|errors)\.csv$/.test(
      fileName,
    )
  )
    throw new Error("Invalid CSV file name.");
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  const file = new File(Paths.cache, `${randomUUID()}-${fileName}`);
  try {
    file.create();
    file.write(text);
    await Sharing.shareAsync(file.uri, {
      mimeType: "text/csv",
      UTI: "public.comma-separated-values-text",
      dialogTitle: "Save CSV",
    });
  } finally {
    if (file.exists) file.delete();
  }
}

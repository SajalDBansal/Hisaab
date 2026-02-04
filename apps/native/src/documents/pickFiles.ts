import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import type { DocumentFile } from "@repo/core";
import { DocumentContentType } from "@repo/contracts";
import { localFileSize } from "@/data/documentFiles";
import { documentName } from "@/data/documentName";
import { compressImage } from "./compressImage";

export type FileSource = "camera" | "gallery" | "file";

async function prepareFiles(files: DocumentFile[]) {
  if (files.length > 10) throw new Error("Select up to 10 files at a time.");
  const result: DocumentFile[] = [];
  // Process one photo at a time so a large selection cannot exhaust phone memory.
  for (const file of files) {
    if (!DocumentContentType.safeParse(file.contentType).success)
      throw new Error("Choose a JPG, PNG, HEIC image or PDF document.");
    result.push(checkedFile(await compressImage(file)));
  }
  return result;
}

function checkedFile(file: DocumentFile) {
  if (!DocumentContentType.safeParse(file.contentType).success)
    throw new Error("Choose a JPG, PNG, HEIC image or PDF document.");
  if (file.sizeBytes <= 0 || file.sizeBytes > 10 * 1024 * 1024)
    throw new Error("Each document must be between 1 byte and 10 MB.");
  return { ...file, name: documentName(file.name, file.contentType) };
}

export async function pickFiles(source: FileSource): Promise<DocumentFile[]> {
  if (source === "file") {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/heic",
        "image/heif",
      ],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return [];
    return prepareFiles(
      result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        contentType: a.mimeType ?? "application/octet-stream",
        sizeBytes: a.size ?? localFileSize(a.uri),
      })),
    );
  }
  if (
    source === "camera" &&
    !(await ImagePicker.requestCameraPermissionsAsync()).granted
  )
    throw new Error(
      "Camera access is disabled. Enable it in your phone's app permissions, or choose Gallery.",
    );
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.9,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          selectionLimit: 10,
          quality: 1,
        });
  if (result.canceled) return [];
  return prepareFiles(
    result.assets.map((a) => ({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}.jpg`,
      contentType: a.mimeType ?? "image/jpeg",
      sizeBytes: a.fileSize ?? a.file?.size ?? localFileSize(a.uri),
    })),
  );
}

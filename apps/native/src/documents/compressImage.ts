import { Image } from "react-native";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { DocumentFile } from "@repo/core";
import { localFileSize } from "@/data/documentFiles";
import { documentName } from "@/data/documentName";
import { imageSize } from "./imageSize";

// Compression happens on the device before requesting an R2 upload URL.
export async function compressImage(file: DocumentFile): Promise<DocumentFile> {
  if (!file.contentType.startsWith("image/")) return file;
  const dimensions = await Image.getSize(file.uri);
  const size = imageSize(dimensions.width, dimensions.height);
  const context = ImageManipulator.manipulate(file.uri);
  try {
    context.resize(size);
    const rendered = await context.renderAsync();
    try {
      const result = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.85,
      });
      return {
        uri: result.uri,
        name: documentName(file.name, "image/jpeg"),
        contentType: "image/jpeg",
        sizeBytes: localFileSize(result.uri),
      };
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

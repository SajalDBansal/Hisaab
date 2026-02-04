import type { DocumentFile } from "@repo/core";
import { documentName } from "@/data/documentName";
import { imageSize } from "./imageSize";

// Browsers use the same JPEG size policy without uploading the original photo.
export async function compressImage(file: DocumentFile): Promise<DocumentFile> {
  if (!file.contentType.startsWith("image/")) return file;
  const image = new Image();
  image.src = file.uri;
  try {
    await image.decode();
    const size = imageSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image compression is unavailable.");
    context.fillStyle = "white";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Image compression failed.")),
        "image/jpeg",
        0.85,
      ),
    );
    // Data URIs remain valid for attachment retries; no unreleased object URLs accumulate.
    const uri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new Error("Couldn't read the compressed image."));
      reader.readAsDataURL(blob);
    });
    return {
      uri,
      name: documentName(file.name, "image/jpeg"),
      contentType: "image/jpeg",
      sizeBytes: blob.size,
    };
  } catch {
    throw new Error(
      "This browser cannot read this image. Choose a JPG or PNG, or use the mobile app for HEIC photos.",
    );
  }
}

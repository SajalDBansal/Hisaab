import type { DocumentFile } from "@repo/core";

export async function uploadDocumentFile(url: string, file: DocumentFile) {
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.contentType },
    body: blob,
  });
  if (!response.ok)
    throw new Error(
      "The file upload failed. Check your connection and the bucket CORS settings.",
    );
}

export async function saveDocumentFile(
  url: string,
  name: string,
  share = false,
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The download failed. Please try again.");
  const blob = await response.blob();
  const file = new File([blob], name, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const localFileSize = (_uri: string): number => 0;

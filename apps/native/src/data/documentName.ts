const extensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

// Download names always match the verified content type, regardless of the display name.
export function documentName(name: string, contentType?: string) {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "document";
  const extension = extensions[contentType ?? ""];
  if (!extension) return safe;
  return safe.replace(/\.[a-z0-9]{1,8}$/i, "").slice(0, 110) + extension;
}

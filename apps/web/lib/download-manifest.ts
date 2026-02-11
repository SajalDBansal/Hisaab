export const DOWNLOADS_ORIGIN = "https://downloads.hisaab.sajaldbansal.com";
export const ANDROID_PACKAGE = "com.sajaldbansal.hisaab";

export type DownloadManifest = {
  schemaVersion: 1;
  version: string;
  buildNumber: number;
  publishedAt: string;
  android: {
    url: string;
    sha256: string;
    sizeBytes: number;
    packageName: typeof ANDROID_PACKAGE;
  };
};

export function downloadManifestUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.origin !== DOWNLOADS_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== value.trim() ||
      !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  // Date.parse normalizes impossible dates such as February 30.
  return (
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) ===
    value.slice(0, 10)
  );
}

export function parseDownloadManifest(value: unknown): DownloadManifest | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.version !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(value.version) ||
    !positiveInteger(value.buildNumber) ||
    !isoTimestamp(value.publishedAt) ||
    !isRecord(value.android)
  )
    return null;

  const android = value.android;
  const apkUrl = `${DOWNLOADS_ORIGIN}/android/${value.version}/${value.buildNumber}/hisaab.apk`;
  if (
    android.url !== apkUrl ||
    android.packageName !== ANDROID_PACKAGE ||
    typeof android.sha256 !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(android.sha256) ||
    !positiveInteger(android.sizeBytes)
  )
    return null;

  return {
    schemaVersion: 1,
    version: value.version,
    buildNumber: value.buildNumber,
    publishedAt: value.publishedAt,
    android: {
      url: apkUrl,
      sha256: android.sha256.toLowerCase(),
      sizeBytes: android.sizeBytes,
      packageName: ANDROID_PACKAGE,
    },
  };
}

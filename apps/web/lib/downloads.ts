import {
  downloadManifestUrl,
  parseDownloadManifest,
  type DownloadManifest,
} from "./download-manifest";

const MAX_MANIFEST_BYTES = 16 * 1024;
const AVAILABLE_CACHE_MS = 60_000;
const UNAVAILABLE_CACHE_MS = 15_000;
type ManifestFetch = (url: string, options: RequestInit) => Promise<Response>;

async function fetchManifest(
  url: string,
  fetcher: ManifestFetch,
  timeoutMs: number,
): Promise<DownloadManifest | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== url) ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !==
        "application/json" ||
      Number(response.headers.get("content-length")) > MAX_MANIFEST_BYTES ||
      !response.body
    )
      return null;

    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MANIFEST_BYTES) return null;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return parseDownloadManifest(JSON.parse(body));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

// Cache only bounded, validated data. Expired releases are never served on error.
export function createDownloadLoader(
  configuredUrl: string | undefined,
  {
    fetcher = (url, options) => fetch(url, options),
    now = Date.now,
    timeoutMs = 5_000,
  }: { fetcher?: ManifestFetch; now?: () => number; timeoutMs?: number } = {},
) {
  const url = downloadManifestUrl(configuredUrl);
  let cached: DownloadManifest | null = null;
  let expiresAt = 0;
  let pending: Promise<DownloadManifest | null> | null = null;

  return async (): Promise<DownloadManifest | null> => {
    if (!url) return null;
    if (now() < expiresAt) return cached;
    if (pending) return pending;
    pending = fetchManifest(url, fetcher, timeoutMs).then((manifest) => {
      cached = manifest;
      expiresAt =
        now() + (manifest ? AVAILABLE_CACHE_MS : UNAVAILABLE_CACHE_MS);
      pending = null;
      return manifest;
    });
    return pending;
  };
}

// Used by the downloads Server Component; no browser-side manifest requests.
export const getAndroidRelease = createDownloadLoader(
  process.env.NEXT_PUBLIC_DOWNLOAD_MANIFEST_URL,
);

import { ApiFailure } from "./apiFailure";

export const API_TIMEOUT_MS = 30_000;

/** Honor text endpoints without treating malformed JSON as a successful string. */
export function parseApiBody(
  text: string,
  contentType: string | null,
): unknown {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === "text/plain" || mediaType === "text/html") return text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One deadline covers headers and body; uncertain writes keep their existing retry key. */
export async function requestApi(
  url: string,
  init: RequestInit,
  timeoutMs = API_TIMEOUT_MS,
  send: typeof fetch = fetch,
  onHeaders?: (response: Response) => void,
) {
  const controller = new AbortController();
  const writing = !["GET", "HEAD"].includes(
    (init.method ?? "GET").toUpperCase(),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failure = (timeout: boolean) =>
    new ApiFailure(
      0,
      timeout ? "REQUEST_TIMEOUT" : "OFFLINE",
      writing
        ? "The server's answer could not be confirmed. Check pending saves before trying again; the original request may already be saved."
        : timeout
          ? "The server took too long to answer. Check your connection and try again."
          : "Can't reach the server. Check your internet and try again.",
      writing ? { outcome: "unknown" } : {},
    );
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(failure(true));
      controller.abort();
    }, timeoutMs);
  });
  const read = async () => {
    try {
      const response = await send(url, { ...init, signal: controller.signal });
      onHeaders?.(response);
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      throw failure(false);
    }
  };
  try {
    return await Promise.race([read(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

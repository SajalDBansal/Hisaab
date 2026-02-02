function isLoopback(host: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

function isPrivateAddress(host: string) {
  if (isLoopback(host)) return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
  );
}

/** Keep local browser cookies same-site while phones still use the LAN API. */
export function webApiUrl(
  apiUrl: string,
  browserOrigin: string,
  override?: string,
) {
  if (override?.trim()) return override.trim();
  const api = new URL(apiUrl);
  const page = new URL(browserOrigin);
  if (
    page.protocol === "http:" &&
    isLoopback(page.hostname) &&
    api.protocol === "http:" &&
    isPrivateAddress(api.hostname)
  ) {
    api.hostname = page.hostname;
    return api.toString().replace(/\/$/, "");
  }
  return apiUrl;
}

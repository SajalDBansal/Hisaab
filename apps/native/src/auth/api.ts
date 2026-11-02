import { Platform } from "react-native";
import { API_URL } from "./config";
import { PLATFORM, deviceName } from "./device";
import { secretsSupported } from "./storage";
import { sessionStore } from "./session";
import { ApiFailure } from "./apiFailure";
import { parseApiBody, requestApi } from "./apiRequest";
import { RECOVERY_EPOCH_HEADER } from "@repo/contracts";
import { serverRecovery, recoveryRequired } from "../data/recoveryEpoch";
export { ApiFailure } from "./apiFailure";

// Cookies from several Set-Cookie headers, reduced to "name=value; name2=value2"
function cookieFromHeader(
  setCookie: string | null,
  previous: string | null,
): string | null {
  if (!setCookie) return previous;
  const jar = new Map<string, string>();
  for (const part of (previous ?? "").split("; ").filter(Boolean)) {
    const [name, ...rest] = part.split("=");
    if (name) jar.set(name, rest.join("="));
  }
  // React Native joins several Set-Cookie headers with commas; split on commas that start a new cookie
  for (const cookie of setCookie.split(/,(?=\s*[\w.-]+=)/)) {
    const [pair = ""] = cookie.split(";");
    const [name, ...rest] = pair.trim().split("=");
    if (!name) continue;
    const value = rest.join("=");
    if (value === "" || /max-age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ") || null;
}

/** Calls the API. Adds who we are (app or web), keeps the login cookie, and turns errors into ApiFailure. */
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: object;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const revision = sessionStore.revision;
  const generation = serverRecovery.snapshot();
  const method = options.method ?? (options.body ? "POST" : "GET");
  const headers: Record<string, string> = {
    // The server rejects a JSON content type with no body, so only say it when there is one
    ...(options.body ? { "content-type": "application/json" } : {}),
    "x-platform": PLATFORM,
    "x-device-name": deviceName(),
    ...(generation.value ? { [RECOVERY_EPOCH_HEADER]: generation.value } : {}),
    ...options.headers,
  };
  let stored: string | null = null;
  if (secretsSupported) {
    stored = await sessionStore.readCookie();
    if (stored) headers.cookie = stored;
    // A phone sends no Origin; the server's Expo plugin reads this one instead
    headers["expo-origin"] = "hisaab://";
  }

  const { response, text } = await requestApi(
    `${API_URL}${path}`,
    {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      // On the web the browser keeps the cookie; on a phone we do it ourselves
      credentials: Platform.OS === "web" ? "include" : "omit",
    },
    undefined,
    undefined,
    (reply) => {
      const epoch = serverRecovery.observe(
        reply.headers.get(RECOVERY_EPOCH_HEADER),
        generation,
      );
      if (
        path.startsWith("/v1/") &&
        !["GET", "HEAD"].includes(method) &&
        headers[RECOVERY_EPOCH_HEADER] &&
        headers[RECOVERY_EPOCH_HEADER] !== epoch
      )
        throw recoveryRequired();
    },
  );

  if (secretsSupported) {
    const next = cookieFromHeader(response.headers.get("set-cookie"), stored);
    if (next !== stored) {
      await sessionStore.saveCookie(next, revision);
    }
  }

  const data = parseApiBody(text, response.headers.get("content-type"));
  if (!response.ok) {
    // Our routes reply { error: { code, message } }; Better Auth replies { code, message }
    const body = (data && typeof data === "object" ? data : {}) as Record<
      string,
      unknown
    >;
    const inner = (
      body.error && typeof body.error === "object" ? body.error : body
    ) as Record<string, unknown>;
    throw new ApiFailure(
      response.status,
      String(inner.code ?? "ERROR"),
      friendlyMessage(
        String(inner.code ?? ""),
        String(inner.message ?? "Something went wrong. Please try again."),
      ),
      body,
    );
  }
  return data as T;
}

// Plain-language versions of the codes the server can send
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email or password isn't right.",
  EMAIL_NOT_VERIFIED: "Please verify your email first.",
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong tries. Ask for a new code.",
  PHONE_TAKEN: "This mobile number is already registered.",
  INVALID_MOBILE: "Enter a 10-digit Indian mobile number.",
  USER_ALREADY_EXISTS:
    "An account with this email already exists. Try logging in.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for the password.",
  SESSION_REPLACED:
    "You were logged out because this account was opened on another device.",
};
const friendlyMessage = (code: string, fallback: string) =>
  MESSAGES[code] ?? fallback;

/** Forget the login on this phone. */
export const clearLogin = () => sessionStore.clear();

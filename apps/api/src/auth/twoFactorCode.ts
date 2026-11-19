import { TwoFactorCode } from "@repo/contracts";
import { APIError } from "better-auth/api";
import type { Auth } from "./auth";

/** Recovery codes are stored as "abcde-12345"; people may type them without the dash. */
export function recoveryCodeForm(code: string) {
  const plain = code.trim();
  return /^[A-Za-z0-9]{10}$/.test(plain)
    ? `${plain.slice(0, 5)}-${plain.slice(5)}`
    : plain;
}

/**
 * Checks a code from the caller's authenticator app, or one of their recovery
 * codes (which is then used up), against the logged-in session in `headers`.
 */
export async function confirmTwoFactorCode(
  auth: Auth,
  headers: Headers,
  code: unknown,
) {
  const parsed = TwoFactorCode.safeParse(code);
  if (!parsed.success) return false;
  // Only for a logged-in session: without one the plugin would treat this as a sign-in.
  if (!(await auth.api.getSession({ headers }))) return false;
  try {
    if (/^\d{6}$/.test(parsed.data))
      await auth.api.verifyTOTP({ headers, body: { code: parsed.data } });
    else
      await auth.api.verifyBackupCode({
        headers,
        body: { code: recoveryCodeForm(parsed.data), disableSession: true },
      });
    return true;
  } catch (error) {
    if (error instanceof APIError) return false;
    throw error;
  }
}

import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import type { Db } from "@repo/backend/db/client";
import { schema } from "@repo/backend/db/client";

// Two-factor sign-in (doc 37, T58), on top of Better Auth's two-factor plugin.
//
// The plugin turns a password sign-in into a code challenge: the password
// step's session is created and then deleted again, and the real session is
// made when the code is right. These rules keep that safe with our own
// one-session-per-platform rule and our other ways of getting a session.

/** Password sign-ins that the plugin turns into a code challenge. */
const FIRST_FACTOR_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/phone-number",
]);

/** Trusted devices are not offered: the cookie that would skip the code. */
const TRUST_COOKIE = /(?:^|;\s*)(?:__Secure-)?hisaab\.trust_device=/;

interface HookContext {
  path?: string;
  headers?: Headers;
  context?: { session?: { user?: { id?: string } } | null };
}

export async function hasTwoFactor(db: Db, userId: string) {
  const [row] = await db
    .select({ on: schema.user.twoFactorEnabled })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row?.on === true;
}

/**
 * Before a session is made for a person with two-factor on: refuse every way
 * in that skips the code (email-code sign-in, sign-in after email
 * verification). Allowed: the password step (the plugin swaps it for a
 * challenge), the plugin's own endpoints (a session only after a right code,
 * or a refresh of one already proven), and refreshes of the caller's own
 * session (password change).
 */
export async function guardSessionCreate(
  db: Db,
  ctx: HookContext | null | undefined,
  userId: string,
) {
  const path = ctx?.path;
  if (!ctx || !path) return; // Server-side calls, never from a request
  if (FIRST_FACTOR_PATHS.has(path) || path.startsWith("/two-factor/")) return;
  if (ctx.context?.session?.user?.id === userId) return;
  if (!(await hasTwoFactor(db, userId))) return;
  throw new APIError("FORBIDDEN", {
    code: "TWO_FACTOR_SIGN_IN",
    message:
      "This account uses an authenticator app. Log in with your password and the app's code.",
  });
}

/**
 * True when this session is only the password step of a two-factor sign-in:
 * the plugin deletes it right away, so it must not log out the other device.
 * That happens when the code is right and the real session is made.
 */
export async function isPendingChallenge(
  db: Db,
  ctx: HookContext | null | undefined,
  userId: string,
) {
  if (!ctx?.path || !FIRST_FACTOR_PATHS.has(ctx.path)) return false;
  // A trust cookie would keep the session, so then the usual rule applies.
  if (TRUST_COOKIE.test(ctx.headers?.get("cookie") ?? "")) return false;
  return hasTwoFactor(db, userId);
}

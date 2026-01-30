import { createHash } from "node:crypto";
import { Platform } from "@repo/contracts";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@repo/backend/db/client";
import { schema } from "@repo/backend/db/client";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Reads the unsigned Better Auth session token from the cookie header. */
export function tokenFromCookie(cookieHeader: string | null | undefined) {
  const match = /(?:^|;\s*)(?:__Secure-)?hisaab\.session_token=([^;]+)/.exec(
    cookieHeader ?? "",
  );
  try {
    return match?.[1] ? decodeURIComponent(match[1]).split(".")[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Which kind of client is calling (phone app or website), and what to call the device. */
export function readClient(headers?: Headers) {
  const platform = Platform.safeParse(headers?.get("x-platform"));
  return {
    platform: platform.success ? platform.data : ("app" as const),
    deviceName: headers?.get("x-device-name")?.slice(0, 80) ?? null,
  };
}

interface HookContext {
  context: {
    internalAdapter: {
      listSessions: (
        userId: string,
      ) => Promise<{ id: string; token: string; expiresAt: Date }[]>;
      deleteSession: (token: string) => Promise<void>;
    };
  };
  headers?: Headers;
}

/**
 * One session per platform: after a new login on this platform, end the user's older ones
 * and remember them, so their device is told SESSION_REPLACED instead of just "log in".
 */
export async function endOtherSessions(
  db: Db,
  ctx: HookContext,
  created: { id: string; token: string; userId: string },
) {
  const { platform } = readClient(ctx.headers);
  const all = (await ctx.context.internalAdapter.listSessions(
    created.userId,
  )) as {
    id: string;
    token: string;
    platform?: string;
  }[];
  const older = all.filter(
    (s) => s.id !== created.id && s.platform === platform,
  );
  if (older.length === 0) return;

  await db
    .insert(schema.replacedSessions)
    .values(
      older.map((s) => ({
        tokenHash: hashToken(s.token),
        userId: created.userId,
      })),
    )
    .onConflictDoNothing();
  for (const s of older)
    await ctx.context.internalAdapter.deleteSession(s.token);
}

/** Was this token ended because the account was opened somewhere else? */
export async function wasReplaced(db: Db, token: string) {
  const [row] = await db
    .select({ hash: schema.replacedSessions.tokenHash })
    .from(schema.replacedSessions)
    .where(eq(schema.replacedSessions.tokenHash, hashToken(token)))
    .limit(1);
  return row !== undefined;
}

// Used by tests and clean-up jobs
export const forgetReplaced = (db: Db, hashes: string[]) =>
  db
    .delete(schema.replacedSessions)
    .where(inArray(schema.replacedSessions.tokenHash, hashes));

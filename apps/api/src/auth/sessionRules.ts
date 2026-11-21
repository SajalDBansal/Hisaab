import { createHash } from "node:crypto";
import { Platform } from "@repo/contracts";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
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
      deleteSession: (token: string) => Promise<void>;
    };
  };
  headers?: Headers;
}

/**
 * Choose one session per platform, even when both new rows already exist.
 * Returns false if another takeover already removed this request's session.
 */
export async function endOtherSessions(
  db: Db,
  ctx: HookContext,
  created: { id: string; token: string; userId: string },
) {
  const { platform } = readClient(ctx.headers);
  const removed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`session:${created.userId}:${platform}`}, 0))`,
    );
    const slot = and(
      eq(schema.session.userId, created.userId),
      eq(schema.session.platform, platform),
    );
    const [current] = await tx
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(
        and(
          slot,
          eq(schema.session.id, created.id),
          eq(schema.session.token, created.token),
        ),
      )
      .for("update");
    // Taking the lock alone is insufficient: a waiting hook may already have lost.
    if (!current) return null;

    const others = await tx
      .delete(schema.session)
      .where(and(slot, ne(schema.session.id, created.id)))
      .returning({ token: schema.session.token });
    if (others.length > 0)
      await tx
        .insert(schema.replacedSessions)
        .values(
          others.map((s) => ({
            tokenHash: hashToken(s.token),
            userId: created.userId,
          })),
        )
        .onConflictDoNothing();
    return others;
  });
  if (!removed) return false;

  // Keep Better Auth's token/active-session caches in sync after the DB commits.
  // Only invalidate the exact tokens removed above, never a fresh session list.
  for (const s of removed)
    await ctx.context.internalAdapter.deleteSession(s.token);
  return true;
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

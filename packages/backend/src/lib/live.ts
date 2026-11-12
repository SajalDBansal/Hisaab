import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";

// The API and the live service share nothing but PostgreSQL, Redis and this
// file. Events travel on one PostgreSQL NOTIFY channel, so every live service
// instance hears every event and none of them has to remember anything.

export const LIVE_CHANNEL = "hisaab_live";

/** Redis key of a firm's data version, bumped by the API after every write. */
export const firmVersionKey = (firmId: string) => `firm:${firmId}:ver`;

/** What the services tell each other. Kept small: NOTIFY payloads stop at 8 KB. */
export const LiveEvent = z.discriminatedUnion("t", [
  /** A write to firm `f` committed; `v` is its new data version. */
  z.object({ t: z.literal("changed"), f: z.string(), v: z.string() }),
  /** User `u`'s membership in firm `f` was added, changed or removed (database trigger). */
  z.object({ t: z.literal("access"), f: z.string(), u: z.string() }),
  /** Session `s` of user `u` ended: logout, takeover or revocation (database trigger). */
  z.object({ t: z.literal("session"), u: z.string(), s: z.string() }),
  /** Someone in firm `f` connected or disconnected. */
  z.object({ t: z.literal("presence"), f: z.string() }),
]);
export type LiveEvent = z.infer<typeof LiveEvent>;

export function parseLiveEvent(payload: string | undefined) {
  if (!payload) return null;
  try {
    const parsed = LiveEvent.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Announce an event. Outside a transaction it is delivered at once; inside, on commit. */
export async function publishLive(db: Pick<Db, "execute">, event: LiveEvent) {
  await db.execute(
    sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(event)})`,
  );
}

// ---- One-time passes from the API to the live service ----------------------

export const LIVE_TICKET_SECONDS = 60;

const TicketClaims = z.object({
  /** user */
  u: z.string(),
  /** session */
  s: z.string(),
  /** firm */
  f: z.string(),
  /** single-use id */
  j: z.string(),
  /** expiry, seconds since epoch */
  exp: z.number().int(),
});
export type LiveTicketClaims = z.infer<typeof TicketClaims>;

const sign = (secret: string, body: string) =>
  createHmac("sha256", secret).update(`live1.${body}`).digest("base64url");

export function issueLiveTicket(
  secret: string,
  claims: { userId: string; sessionId: string; firmId: string },
  now = Date.now(),
) {
  const exp = Math.floor(now / 1000) + LIVE_TICKET_SECONDS;
  const body = Buffer.from(
    JSON.stringify({
      u: claims.userId,
      s: claims.sessionId,
      f: claims.firmId,
      j: randomUUID(),
      exp,
    } satisfies LiveTicketClaims),
  ).toString("base64url");
  return {
    ticket: `${body}.${sign(secret, body)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Returns the claims of a genuine, unexpired ticket, or null. */
export function readLiveTicket(
  secret: string,
  ticket: string,
  now = Date.now(),
): LiveTicketClaims | null {
  const [body, mac, extra] = ticket.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claims = TicketClaims.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (!claims.success || claims.data.exp * 1000 <= now) return null;
    return claims.data;
  } catch {
    return null;
  }
}

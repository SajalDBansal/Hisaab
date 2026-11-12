import type { RedisClient } from "./redis";

// Who is online lives in Redis, not in any live service instance. Each open
// connection refreshes its entry on every heartbeat; an entry that stops being
// refreshed (closed tab, crashed instance) simply ages out.

/** An entry not refreshed for this long counts as offline. */
export const PRESENCE_TTL_MS = 75_000;

export type PresenceEntry = {
  firmId: string;
  userId: string;
  platform: "app" | "web";
  device: string;
  /** ISO time the connection opened. */
  since: string;
};

const connKey = (connId: string) => `live:conn:${connId}`;
const firmKey = (firmId: string) => `live:firm:${firmId}`;
const userKey = (userId: string) => `live:user:${userId}`;

/** Add or refresh one connection. */
export async function touchPresence(
  redis: RedisClient,
  connId: string,
  entry: PresenceEntry,
  now = Date.now(),
) {
  await redis
    .multi()
    .set(connKey(connId), JSON.stringify(entry), "PX", PRESENCE_TTL_MS)
    .zadd(firmKey(entry.firmId), now, connId)
    .pexpire(firmKey(entry.firmId), PRESENCE_TTL_MS * 4)
    .zadd(userKey(entry.userId), now, connId)
    .pexpire(userKey(entry.userId), PRESENCE_TTL_MS * 4)
    .exec();
}

export async function dropPresence(
  redis: RedisClient,
  connId: string,
  entry: Pick<PresenceEntry, "firmId" | "userId">,
) {
  await redis
    .multi()
    .del(connKey(connId))
    .zrem(firmKey(entry.firmId), connId)
    .zrem(userKey(entry.userId), connId)
    .exec();
}

/** Live connections this person has open, across every instance and firm. */
export async function countUserConnections(
  redis: RedisClient,
  userId: string,
  now = Date.now(),
) {
  return redis.zcount(userKey(userId), now - PRESENCE_TTL_MS, "+inf");
}

/** Everyone connected to a firm right now. Old entries are pruned on the way. */
export async function firmPresence(
  redis: RedisClient,
  firmId: string,
  now = Date.now(),
): Promise<PresenceEntry[]> {
  const cutoff = now - PRESENCE_TTL_MS;
  await redis.zremrangebyscore(firmKey(firmId), "-inf", `(${cutoff}`);
  const ids = await redis.zrangebyscore(firmKey(firmId), cutoff, "+inf");
  if (!ids.length) return [];
  const rows = await redis.mget(ids.map(connKey));
  const entries: PresenceEntry[] = [];
  for (const row of rows) {
    if (!row) continue;
    try {
      const entry = JSON.parse(row) as PresenceEntry;
      if (entry.firmId === firmId) entries.push(entry);
    } catch {
      /* A damaged entry is skipped; it expires on its own. */
    }
  }
  return entries;
}

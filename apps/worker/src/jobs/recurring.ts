import type { FastifyBaseLogger } from "fastify";
import type { Db } from "@repo/backend/db/client";
import { firmVersionKey, publishLive } from "@repo/backend/lib/live";
import type { RedisClient } from "@repo/backend/lib/redis";
import { runRecurring } from "@repo/backend/modules/recurring/recurring.repo";

/**
 * Recurring entries (doc 37, T03): make the drafts that are due, then tell
 * each firm's open screens (the bell and the review list refresh). Safe to
 * retry: a schedule's draft for a date is made once.
 */
export async function runRecurringEntries(
  ctx: {
    db: Db;
    redis?: RedisClient;
    log: Pick<FastifyBaseLogger, "info" | "warn">;
  },
  now = new Date(),
) {
  const result = await runRecurring(ctx.db, now);
  for (const firmId of result.firms) {
    try {
      const version = ctx.redis
        ? String(await ctx.redis.incr(firmVersionKey(firmId)))
        : String(Date.now());
      await publishLive(ctx.db, { t: "changed", f: firmId, v: version });
    } catch (err) {
      ctx.log.warn({ err, firmId }, "Recurring change notice was not sent");
    }
  }
  if (result.schedules)
    ctx.log.info(
      {
        schedules: result.schedules,
        drafts: result.drafts,
        skipped: result.skipped,
      },
      "Recurring entries made",
    );
  return {
    schedules: result.schedules,
    drafts: result.drafts,
    skipped: result.skipped,
  };
}

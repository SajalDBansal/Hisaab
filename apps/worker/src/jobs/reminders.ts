import {
  dueReminders,
  today as businessDate,
  type ReminderDue,
} from "@repo/core";
import { asc, eq, gt } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import type { RedisClient } from "@repo/backend/lib/redis";
import { notificationsRepo } from "@repo/backend/modules/notifications/notifications.repo";
import type { JobQueueClient, ReminderJob } from "@repo/backend/jobs/queues";

const SCAN_TTL_SECONDS = 2 * 24 * 60 * 60;

export type ReminderScan = {
  firmId: string;
  asOf: string;
  preparedAt: string;
  mode: "manual-share";
  delivered: 0;
  due: ReminderDue[];
};

export { businessDate };

function scanKey(firmId: string, asOf: string) {
  return `hisaab:reminder-scan:${firmId}:${asOf}`;
}

// Preparing reminders is repeatable; it never advances the customer's sent date.
export async function prepareReminders(
  db: Db,
  firmId: string,
  now = new Date(),
): Promise<ReminderScan> {
  const books = await db.transaction(
    (tx) => notificationsRepo.books(tx as unknown as Db, firmId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const asOf = businessDate(now);
  return {
    firmId,
    asOf,
    preparedAt: now.toISOString(),
    mode: "manual-share",
    delivered: 0,
    due: dueReminders(
      books.parties,
      books.vouchers,
      books.reminders,
      asOf,
      books.remindedOn,
    ),
  };
}

export async function readReminderScan(
  redis: RedisClient,
  firmId: string,
  now = new Date(),
): Promise<ReminderScan | undefined> {
  const saved = await redis.get(scanKey(firmId, businessDate(now)));
  return saved ? (JSON.parse(saved) as ReminderScan) : undefined;
}

async function queueFirmScans(db: Db, jobs: JobQueueClient, asOf: string) {
  let cursor: string | undefined;
  let queued = 0;
  // Keep queue payloads small and isolate retries to one firm at a time.
  for (;;) {
    const firms = await db
      .select({ id: schema.firmProfile.firmId })
      .from(schema.firmProfile)
      .where(cursor ? gt(schema.firmProfile.firmId, cursor) : undefined)
      .orderBy(asc(schema.firmProfile.firmId))
      .limit(100);
    if (!firms.length) break;
    for (const firm of firms) {
      await jobs.add(
        "reminders",
        { kind: "scan-firm", firmId: firm.id, asOf },
        { retryFailed: true },
      );
      queued += 1;
    }
    cursor = firms.at(-1)?.id;
  }
  return { queued, delivered: 0 as const, mode: "manual-share" as const };
}

export async function runReminders(
  job: ReminderJob,
  ctx: { db: Db; redis: RedisClient; jobs: JobQueueClient },
  now = new Date(),
) {
  const asOf = businessDate(now);
  if (job.kind === "scan-all-firms")
    return queueFirmScans(ctx.db, ctx.jobs, asOf);
  const [firm] = await ctx.db
    .select({ id: schema.firmProfile.firmId })
    .from(schema.firmProfile)
    .where(eq(schema.firmProfile.firmId, job.firmId));
  if (!firm) return { skipped: "firm-removed", delivered: 0 };
  // A delayed retry must not prepare yesterday's balances or notifications.
  if (job.asOf && job.asOf !== asOf)
    return { skipped: "expired-scan", delivered: 0 };
  const scan = await prepareReminders(ctx.db, job.firmId, now);
  await ctx.redis.set(
    scanKey(job.firmId, asOf),
    JSON.stringify(scan),
    "EX",
    SCAN_TTL_SECONDS,
  );
  return { prepared: scan.due.length, delivered: 0, mode: scan.mode };
}

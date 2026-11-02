import type { FastifyBaseLogger } from "fastify";
import type { Db } from "@repo/backend/db/client";
import { purgeOldKeys } from "@repo/backend/modules/vouchers/idempotency";
import type {
  JobData,
  JobQueueClient,
  PdfJob,
  QueueName,
  ReminderJob,
} from "@repo/backend/jobs/queues";
import { UnrecoverableError } from "bullmq";
import { runReminders } from "./reminders";
import type { RedisClient } from "@repo/backend/lib/redis";
import {
  renderVoucherPdf,
  type PdfRenderer,
} from "@repo/backend/modules/server-pdf/server-pdf.service";
import type { PdfStorage } from "@repo/backend/modules/server-pdf/storage";
import { runDocumentCleanup } from "@repo/backend/modules/documents/cleanup";
import type { DocumentCleanupStorage } from "@repo/backend/modules/documents/cleanup-storage";

export type JobContext = {
  db: Db;
  log: Pick<FastifyBaseLogger, "info" | "warn">;
  redis?: RedisClient;
  jobs?: JobQueueClient;
  pdf?: { storage: PdfStorage; render: PdfRenderer };
  backup?: { run(): Promise<unknown> };
  documentStorage?: DocumentCleanupStorage;
  signal?: AbortSignal;
};

export async function handleJob<K extends QueueName>(
  queue: K,
  data: JobData[K],
  ctx: JobContext,
) {
  switch (queue) {
    case "cleanup":
      if (data.kind === "document-cleanup") {
        if (!ctx.documentStorage)
          throw new UnrecoverableError("Document cleanup is not configured.");
        return runDocumentCleanup(ctx.db, ctx.documentStorage, {
          signal: ctx.signal,
        });
      }
      if (data.kind !== "nightly-cleanup") break;
      return runCleanup(ctx);
    case "backup":
      if (data.kind !== "backup-database") break;
      if (!ctx.backup)
        throw new UnrecoverableError(
          "Database backup publication is disabled.",
        );
      return ctx.backup.run();
    case "reminders":
      if (data.kind !== "scan-firm" && data.kind !== "scan-all-firms") break;
      if (!ctx.redis || !ctx.jobs)
        throw new UnrecoverableError("Reminder jobs are not configured.");
      return runReminders(data as ReminderJob, {
        db: ctx.db,
        redis: ctx.redis,
        jobs: ctx.jobs,
      });
    case "pdf":
      if (data.kind !== "render-voucher") break;
      if (!ctx.pdf)
        throw new UnrecoverableError("Server PDF rendering is not configured.");
      return renderVoucherPdf({ db: ctx.db, ...ctx.pdf }, data as PdfJob);
    default:
      break;
  }
  ctx.log.warn({ queue, kind: data.kind }, "Unsupported background job");
  throw new UnrecoverableError(
    `No handler is implemented for ${queue}:${data.kind}.`,
  );
}

async function runCleanup(ctx: JobContext) {
  const idempotencyKeys = await purgeOldKeys(ctx.db);
  ctx.log.info({ idempotencyKeys }, "Nightly cleanup finished");
  return { idempotencyKeys };
}

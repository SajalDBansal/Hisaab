import { Queue, type JobsOptions, type RepeatOptions } from "bullmq";
import { createHash } from "node:crypto";
import { AppError } from "../lib/app-error";
import type { RedisClient } from "../lib/redis";

export const QUEUE_NAMES = [
  "messages",
  "reminders",
  "pdf",
  "backup",
  "reports",
  "cleanup",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export type MessageJob =
  | { kind: "send-email-code"; emailId: string }
  | { kind: "send-invite"; invitationId: string }
  | { kind: "send-whatsapp-code"; verificationId: string }
  | { kind: "send-whatsapp-reminder"; firmId: string; partyId: string };

export type ReminderJob =
  | { kind: "scan-all-firms" }
  | { kind: "scan-firm"; firmId: string; asOf?: string };

export type PdfJob = {
  kind: "render-voucher";
  firmId: string;
  voucherId: string;
  template?: string;
  revision?: string;
};

export type BackupJob = { kind: "backup-database" };

export type ReportJob = {
  kind: "warm-firm";
  firmId: string;
  reason: "write" | "scheduled";
};

export type CleanupJob = { kind: "nightly-cleanup" | "document-cleanup" };

export type JobData = {
  messages: MessageJob;
  reminders: ReminderJob;
  pdf: PdfJob;
  backup: BackupJob;
  reports: ReportJob;
  cleanup: CleanupJob;
};

export type AddJobOptions = {
  delay?: number;
  jobId?: string;
  repeat?: Omit<RepeatOptions, "key">;
  retryFailed?: boolean;
  retryCompleted?: boolean;
};

export type JobRecord = {
  data: JobData[QueueName];
  state: string;
};

export const SUPPORTED_QUEUES = [
  "reminders",
  "pdf",
  "cleanup",
  "backup",
] as const;

function assertSupported(queue: QueueName) {
  if (!(SUPPORTED_QUEUES as readonly string[]).includes(queue))
    throw new AppError(
      "JOB_UNSUPPORTED",
      `The ${queue} job is not supported.`,
      503,
    );
}

export interface JobQueueClient {
  add<K extends QueueName>(
    queue: K,
    data: JobData[K],
    options?: AddJobOptions,
  ): Promise<string>;
  get(queue: QueueName, id: string): Promise<JobRecord | undefined>;
  removeScheduler(queue: QueueName, id: string): Promise<void>;
  close(): Promise<void>;
}

export type MemoryJob = {
  queue: QueueName;
  data: JobData[QueueName];
  options?: AddJobOptions;
  id: string;
};

type BullQueues = Record<QueueName, Queue>;

export function jobIdFor<K extends QueueName>(queue: K, data: JobData[K]) {
  // Hash structured parts to avoid both BullMQ's colon restriction and delimiter collisions.
  const identity = jobIdentity(queue, data);
  return `${queue}-${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function jobIdentity<K extends QueueName>(queue: K, data: JobData[K]) {
  switch (queue) {
    case "messages":
      return data;
    case "reminders": {
      const job = data as ReminderJob;
      return job.kind === "scan-firm"
        ? [job.kind, job.firmId, job.asOf ?? null]
        : [job.kind];
    }
    case "pdf": {
      const job = data as PdfJob;
      return [
        job.kind,
        job.firmId,
        job.voucherId,
        job.template ?? null,
        job.revision ?? null,
      ];
    }
    case "backup": {
      const job = data as BackupJob;
      return job;
    }
    case "reports": {
      const job = data as ReportJob;
      return [job.kind, job.firmId];
    }
    case "cleanup":
      return [(data as CleanupJob).kind];
  }
}

function validJobId(id: string) {
  if (!id || id.includes(":"))
    throw new AppError(
      "INVALID_JOB_ID",
      "Job IDs must be nonempty and contain no colons.",
    );
  return id;
}

function defaultJobOptions(queue: QueueName): JobsOptions {
  return {
    attempts: queue === "messages" ? 3 : 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
  };
}

export function createBullJobs(
  connection: RedisClient,
  prefix = "bull",
): JobQueueClient {
  const queues = Object.fromEntries(
    QUEUE_NAMES.map((name) => [
      name,
      new Queue(name, {
        connection,
        prefix,
        defaultJobOptions: defaultJobOptions(name),
      }),
    ]),
  ) as BullQueues;

  return {
    async add(queue, data, options) {
      assertSupported(queue);
      const id = validJobId(options?.jobId ?? jobIdFor(queue, data));
      if (options?.repeat) {
        const job = await queues[queue].upsertJobScheduler(id, options.repeat, {
          name: data.kind,
          data,
          opts: defaultJobOptions(queue),
        });
        return String(job.id);
      }

      if (options?.retryFailed || options?.retryCompleted) {
        const previous = await queues[queue].getJob(id);
        if (previous) {
          const state = await previous.getState();
          if (
            (state === "failed" && options.retryFailed) ||
            (state === "completed" && options.retryCompleted)
          ) {
            try {
              await previous.retry(state as "failed" | "completed", {
                resetAttemptsMade: true,
                resetAttemptsStarted: true,
              });
            } catch (error) {
              // Another request may already have retried this same deterministic job.
              if (
                ["failed", "completed", "unknown"].includes(
                  await previous.getState(),
                )
              )
                throw error;
            }
            return id;
          }
        }
      }
      const {
        repeat: _repeat,
        retryFailed: _retry,
        retryCompleted: _completed,
        ...addOptions
      } = options ?? {};
      const job = await queues[queue].add(data.kind, data, {
        ...addOptions,
        jobId: id,
      });
      return String(job.id);
    },
    async get(queue, id) {
      const job = await queues[queue].getJob(id);
      return job ? { data: job.data, state: await job.getState() } : undefined;
    },
    async removeScheduler(queue, id) {
      await queues[queue].removeJobScheduler(id);
    },
    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    },
  };
}

export const noopJobs: JobQueueClient = {
  async add() {
    throw new AppError(
      "JOBS_UNAVAILABLE",
      "Background jobs are not configured.",
      503,
    );
  },
  async get() {
    return undefined;
  },
  async removeScheduler() {},
  async close() {},
};

export function createMemoryJobs() {
  const added: MemoryJob[] = [];
  const client: JobQueueClient & { added: MemoryJob[] } = {
    added,
    async add(queue, data, options) {
      assertSupported(queue);
      const id = validJobId(options?.jobId ?? jobIdFor(queue, data));
      if (!added.some((job) => job.queue === queue && job.id === id))
        added.push({ queue, data, options, id });
      return id;
    },
    async get(queue, id) {
      const job = added.find(
        (entry) => entry.queue === queue && entry.id === id,
      );
      return job ? { data: job.data, state: "waiting" } : undefined;
    },
    async removeScheduler(queue, id) {
      const index = added.findIndex(
        (entry) => entry.queue === queue && entry.id === id,
      );
      if (index >= 0) added.splice(index, 1);
    },
    async close() {},
  };
  return client;
}

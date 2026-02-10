import { Worker, type Job } from "bullmq";
import type { RedisClient } from "@repo/backend/lib/redis";
import { handleJob, type JobContext } from "./handlers";
import { SUPPORTED_QUEUES, type JobData } from "@repo/backend/jobs/queues";

export function createJobWorkers(
  connection: RedisClient,
  ctx: JobContext,
  prefix = "bull",
) {
  return SUPPORTED_QUEUES.map((queue) =>
    new Worker(
      queue,
      async (job: Job<JobData[typeof queue]>) =>
        handleJob(queue, job.data, ctx),
      {
        connection,
        prefix,
        concurrency: 1,
      },
    )
      .on("error", (err) =>
        ctx.log.warn({ err, queue }, "Worker connection error"),
      )
      .on("failed", (job, err) =>
        ctx.log.warn({ err, queue, jobId: job?.id }, "Background job failed"),
      ),
  );
}

export async function closeJobWorkers(workers: Worker[]) {
  await Promise.all(workers.map((worker) => worker.close()));
}

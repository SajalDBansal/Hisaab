import type { FastifyInstance } from "fastify";
import { noopJobs, type JobQueueClient } from "@repo/backend/jobs/queues";

declare module "fastify" {
  interface FastifyInstance {
    jobs: JobQueueClient;
  }
}

export function registerJobs(app: FastifyInstance, jobs = noopJobs) {
  app.decorate("jobs", jobs);
  app.addHook("onClose", async () => {
    await jobs.close();
  });
}

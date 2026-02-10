import type { JobQueueClient } from "./queues";

const IST = "Asia/Kolkata";

export async function scheduleRecurringJobs(jobs: JobQueueClient) {
  // Remove legacy definitions so a deployment does not keep producing unsupported jobs.
  await jobs.removeScheduler("backup", "repeat:backup:nightly");
  await jobs.removeScheduler("reminders", "repeat:reminders:10am-ist");
  await jobs.removeScheduler("cleanup", "repeat:cleanup:nightly");
  await Promise.all([
    jobs.add(
      "reminders",
      { kind: "scan-all-firms" },
      {
        jobId: "repeat-reminders-10am-ist",
        repeat: { pattern: "0 10 * * *", tz: IST },
      },
    ),
    jobs.add(
      "cleanup",
      { kind: "nightly-cleanup" },
      {
        jobId: "repeat-cleanup-nightly",
        repeat: { pattern: "30 2 * * *", tz: IST },
      },
    ),
  ]);
}

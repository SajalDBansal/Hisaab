import type { JobQueueClient } from "./queues";

const IST = "Asia/Kolkata";

export async function scheduleRecurringJobs(
  jobs: JobQueueClient,
  backups = false,
) {
  // Remove legacy definitions so a deployment does not keep producing unsupported jobs.
  await jobs.removeScheduler("backup", "repeat:backup:nightly");
  await jobs.removeScheduler("reminders", "repeat:reminders:10am-ist");
  await jobs.removeScheduler("cleanup", "repeat:cleanup:nightly");
  if (!backups) {
    await jobs.removeScheduler("backup", "repeat-backup-2am-ist");
    await jobs.removeScheduler("backup", "repeat-backup-catch-up");
  }
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
    jobs.add(
      "cleanup",
      { kind: "document-cleanup" },
      {
        jobId: "repeat-document-cleanup",
        repeat: { every: 5 * 60_000 },
      },
    ),
  ]);
  if (backups) {
    await jobs.add(
      "backup",
      { kind: "backup-database" },
      {
        jobId: "repeat-backup-2am-ist",
        repeat: { pattern: "0 2 * * *", tz: IST },
      },
    );
    // A periodic due check and startup check recover missed schedules after host downtime.
    await jobs.add(
      "backup",
      { kind: "backup-database" },
      {
        jobId: "repeat-backup-catch-up",
        repeat: { every: 30 * 60_000 },
      },
    );
    await jobs.add(
      "backup",
      { kind: "backup-database" },
      {
        jobId: "backup-startup-check",
        retryCompleted: true,
        retryFailed: true,
      },
    );
  }
}

# 21. Background Jobs

[Documentation index](README.md)

Background jobs run in the independent `apps/worker` application. See its
[README](../apps/worker/README.md) for configuration, health checks and commands.
The API only submits work; queue contracts/storage/readers are in `packages/backend`.
Only worker startup registers recurring schedules.

Start and supervise the worker separately. Its app environment file must point
to the same PostgreSQL, Redis and private document storage as the API. Provide
these services and a PDF browser explicitly. The supplied worker Dockerfile and
Compose service are described in [guide 25](25-docker-and-cicd.md).

## Supported behavior

| Queue       | Behavior                                                                                                                                                                                 | Schedule (Asia/Kolkata) |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `reminders` | Prepares each firm's due-reminder list using the same `dueReminders` rules as the API. Stores a private, two-day Redis snapshot. Does not send WhatsApp messages or mark reminders sent. | Daily at 10:00          |
| `cleanup`   | Removes request-cache rows older than seven days only when a matching committed permanent receipt exists; never deletes permanent operation receipts.                                    | Daily at 02:30          |
| `pdf`       | Renders the existing voucher HTML with Chromium, writes a private PDF to R2/S3, and returns a fresh signed download after completion.                                                    | On request              |
| `cleanup` | Retries tombstoned document object removal only after a verified database snapshot contains the deletion. | Every five minutes |
| `backup` | Opt-in whole PostgreSQL database capture, verified private R2 publication, safe latest-only replacement and external success ping. | Daily at 02:00; startup and 30-minute due checks |

Generic messaging and report-warming jobs are **unsupported**. Their
enqueue calls fail explicitly; workers do not consume these queues. Reports
continue to compute on demand. Existing request ETags still work independently.
The old nightly backup scheduler is removed on startup, along with the legacy
reminder/cleanup scheduler IDs. Already queued unsupported jobs are not deleted
silently: inspect/archive these during deployment. No backup is implied by a
running worker, a successful cleanup job, or a configured document R2 bucket.
Backups require separate credentials, explicit host enrollment and
`BACKUP_ENABLED=true`; see [guide 30](30-postgres-r2-backup-and-ec2-migration.md).
The obsolete per-firm backup payload is still rejected. Only the host operator
can trigger a whole-database backup; normal firm users cannot access it.

## Queue safety

- Deterministic IDs hash structured identity parts. They contain no colons and
  distinguish firms, vouchers, templates and PDF content revisions.
- Completed jobs are kept for up to a day/1,000 records; failed jobs for up to
  seven days/1,000 records. BullMQ applies retention when jobs finalize, not as
  an independent exact-time deletion service.
- Work is repeatable even after queue retention expires: reminder preparation
  overwrites one tenant/date snapshot; PDFs use a content-addressed object key.
- Each supported worker has concurrency one. Retries use exponential backoff;
  unsupported handlers fail permanently rather than retrying fabricated work.
- The production default queue prefix remains `bull` for migration compatibility.
- The worker logs failed jobs and connection errors and drains work on shutdown.
  Monitoring/alert routing still needs deployment configuration.

BullMQ requires custom job IDs without colons and only deduplicates while a job
record remains present. See [job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
and [scheduler management](https://docs.bullmq.io/guide/job-schedulers/manage-job-schedulers).

## Reminder semantics

The daily parent job enumerates firms in batches of 100 and queues one stable
firm/date job. A retry does not duplicate that job. Each child reloads only that
firm's books, applies enabled/minimum-amount/due-date/repeat rules, and excludes
cleared customers and reminders already confirmed sent. Deleted firms and
expired-day scans are skipped explicitly. The shared India business date is used.

The result reports `mode: "manual-share"` and `delivered: 0`. No email, SMS or
WhatsApp provider call is made. No `reminders_sent` row is inserted by a worker.
Opening WhatsApp is not proof of delivery; the existing manual confirmation
endpoint remains the source of user-confirmed send dates.

`prepareReminders(db, firmId)` and `readReminderScan(redis, firmId)` are internal
helpers in `apps/worker/src/jobs/reminders.ts`, not HTTP application imports.

`readReminderScan` is a dated snapshot, not a current balance or send decision.
Refresh live rules and reminder text before offering a share; a receipt may have
been posted after the scheduled scan. The existing `/reminders/due` and reminder
text endpoints already do this. No UI wiring is required for those live reads.

Automatic delivery remains a separate feature requiring consent/preferences,
an approved provider/template, a durable per-recipient outbox, provider
idempotency, webhook verification, failure/retry handling, and distinct
accepted/sent/delivered statuses. Do not label this preparation job as automated
WhatsApp delivery.

## Server PDF integration

The service is independent of the attachment-storage interface and makes no
schema changes. Object keys are
`firms/<firmId>/generated-pdfs/<voucherId>/<print-content-hash>.pdf`.
HTML comes from shared `printVoucher` (also used by `vouchersService.print`), including historical snapshots and
cancelled-document marking. A content change creates a different revision.
Old queued revisions fail explicitly; reads always resolve the current revision.

The API wires `GET /v1/vouchers/:id/pdf` for requests/polling and `POST` on the same
path for explicit failed-job retries. Its shared service is used as follows:

```ts
import { createPdfStorage } from "@repo/backend/modules/server-pdf/storage";
import {
  PdfResponse,
  requestVoucherPdf,
} from "@repo/backend/modules/server-pdf/server-pdf.service";

// Construct once per API process and call pdfStorage.close() on shutdown.
const pdfStorage = createPdfStorage(env);

// Inside the authenticated, firm-scoped voucher PDF route:
const result = await requestVoucherPdf(
  { db, jobs: app.jobs, storage: pdfStorage },
  {
    firmId: req.firm.id,
    voucherId: req.params.id,
    template: req.query.template,
  },
);
return reply.code(result.status === "ready" ? 200 : 202).send(result);
```

Use `PdfResponse` for the route's 200/202 schemas. Results:

- `ready`: `fileName`, `url`, `expiresAt` (ten-minute signed URL).
- `queued` or `processing`: `jobId`; poll the same authorized voucher route.
- `failed`: `jobId`; show a failure, not a perpetual spinner. The explicit POST
  retry passes `{ retryFailed: true }` as the service's third argument.

The route sets `Cache-Control: private, no-store`, bypassing conditional firm ETag
responses: queue progress and signed-ticket expiry are not firm-version changes.
Both methods check membership and voucher-read permission. Keep failed-job retries
on the explicit POST action; GET polling does not retry failed jobs.

The generic queue status method is internal, not a public job-ID endpoint.
Never return raw queue payloads/errors across tenants. Membership and the same
voucher-read permissions used by the normal read route are still required.
The service loads the voucher within the supplied firm before checking/signing
any object. It does not accept a caller-supplied object key. A ready object avoids
enqueueing entirely; a removed object can requeue its completed job.

Queue results contain an object key, never an expiring signed URL. Client caching
must not treat a previous `queued` response or a signed URL as permanent. Bearer
download URLs remain usable until expiry even if the voucher changes meanwhile.
The API's live response resolves the new revision.

## PDF Runtime Requirements

1. `apps/worker` declares `playwright-core` as a runtime dependency and runs the
   PDF renderer.
2. Install a compatible Chromium binary and its OS/font dependencies in the
   worker environment. Set `PDF_BROWSER_PATH` to its executable path in the worker
   environment. For local Windows development an installed Edge executable can be
   used; pin the production browser version and verify PDF rendering after updates.
3. Run Chromium with its sandbox enabled as a non-root user on Linux. Do not fix
   deployment errors by disabling its sandbox. The renderer blocks page scripts,
   service workers and network requests, adds a restrictive CSP, caps HTML/PDF
   sizes, and closes the browser after a 30-second render deadline. Verify
   sandboxed PDF rendering on the intended host with its OS security settings.
4. Give the worker the same private R2/S3 configuration as the API. Generated PDFs
   need only object read/write access. Browser downloads still need the bucket's
   allowed-origin CORS policy; signed URLs do not bypass browser CORS.
5. Start the worker independently: `bun run --cwd apps/worker dev` from the root,
   or `bun run --cwd apps/worker start` after building. Apply pending migrations
   through the API's explicit command before resuming work. Both processes must
   use the same Redis instance and prefix, with separate environment files.

Absent `PDF_BROWSER_PATH`, development warns and PDF jobs fail explicitly;
production rejects the missing setting. Missing storage configuration and S3
403/network failures are not treated as missing objects or successful completion.
Generated PDFs stay in private storage, separate from the public APK release
bucket. No live R2 settings are changed by this module.

Chromium produces A4 classic/modern documents and 80 mm-wide compact documents
paginated at 297 mm. Font coverage, long invoices and target-printer acceptance
still need deployment checks. Rendering uses Playwright's
[PDF API](https://playwright.dev/docs/api/class-page#page-pdf) and
[browser sandbox configuration](https://playwright.dev/docs/api/class-browsertype#browser-type-launch).

Old PDF revisions are derived caches, not backups. Decide and configure an R2
lifecycle rule **only for generated-pdfs objects** if retention is desired.
Never apply a broad `firms/` expiration to uploaded customer documents. Bucket
retention policy and actual recovery drills remain operator responsibilities.

## Manual Checks

On staging, request a PDF through the authenticated HTTP route and confirm that
its job completes, downloads remain private and a failed job exposes a useful
status. Check reminders against paid, unpaid and disabled customers without
sending messages. Confirm cleanup does not remove saved documents.

Repeat PDF rendering on the actual deployment host with the configured browser,
sandbox policy and private storage. Check long invoices, fonts and intended printers.

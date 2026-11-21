# 30. PostgreSQL Backups to R2 and EC2 Account Migration

[Documentation index](README.md) | [EC2 deployment](26-ec2-and-expo-deployment.md) | [Manual recovery](20-manual-recovery.md)

**Status: implementation and local acceptance verification completed, 29 October 2026.**
The worker now contains whole-database backup modules, conditional R2 publication,
operator controls and scheduled due checks. See [Doc 31](31-implementation-and-verification.md)
for the current verification record. Keep backups disabled until the owner's dedicated
private R2 bucket checks and credentials enrollment are complete. No live external
backup bucket has been configured or certified by this document.

Keep clients disconnected during a manual recovery and follow the reconciliation
requirements below. The manual PostgreSQL commands are still useful for a final
migration copy and independent restore verification.

## Start Here After Implementation Checks Pass

The operator commands run inside the existing worker image. They are not public
API endpoints, and they do not require a root `scripts` folder. Run the following
commands on EC2 from the `deployment` directory containing your private `.env`,
`api.env`, `worker.env` and `compose.prod.yml` files.

1. Apply the normal database migrations. Migration `0027` adds durable document
   cleanup and `0028` adds installation backup state. Create the installation's
   first account and firm before enrollment; an empty database is rejected.
2. Create a separate **private** R2 backup bucket and a bucket-scoped object
   read/write/delete key. Do not enable public access or an expiry rule on backup
   objects. Server-to-server backups need no browser CORS policy.
3. Fill the `BACKUP_*` settings in `worker.env` using
   [worker.env.example](../deployment/worker.env.example). Leave
   `BACKUP_ENABLED=false`. Generate separate UUIDs for `BACKUP_INSTALLATION_ID`
   and `BACKUP_WRITER_ID`, for example by running
   `node -e 'console.log(crypto.randomUUID())'` twice. Keep the installation ID
   during a move; give the new host a new writer ID.
4. Configure an independent monitor for **02:00 Asia/Kolkata**, with a grace
   period such as one hour. Put its HTTPS success-ping URL in
   `BACKUP_HEARTBEAT_URL`. Configure and test its alert recipient separately.
   A missing worker cannot send its own failure alert; an external missed-ping
   monitor is required for that case.
5. Initialize the namespace and inspect its state:

   ```bash
   docker compose --env-file .env -f compose.prod.yml run --rm --no-deps -e BACKUP_ENABLED=false worker node dist/backup.js initialize
   docker compose --env-file .env -f compose.prod.yml run --rm --no-deps worker node dist/backup.js status
   ```

6. After reviewing the installation and writer identities, set
   `BACKUP_ENABLED=true` in `worker.env`, then recreate the worker:

   ```bash
   docker compose --env-file .env -f compose.prod.yml up -d --no-deps --force-recreate worker
   docker compose --env-file .env -f compose.prod.yml exec worker node dist/backup.js status
   ```

   Startup checks for a missed 02:00 backup. The daily schedule and a 30-minute
   due check use the same PostgreSQL advisory lock and published capture time,
   so multiple worker processes do not create duplicate due backups.

7. To request a fresh operator backup, run
   `docker compose --env-file .env -f compose.prod.yml exec worker node dist/backup.js run`.
   Status should show a backup ID, capture time, matching identities and no pending
   publication. Download and rehearse restoration before treating it as a usable
   recovery system. A successful upload is not a full restore test.

Implementation limits are deliberately explicit: PostgreSQL client/server major
17, one archive up to **1 GiB**, at least **2 GiB free temporary space**, and a
**20-minute** overall run deadline. Upload and verification stream bytes; they do
not hold the database in memory. A larger database needs a measured limit/storage
change before it reaches this boundary. A count decrease of more than 20% in any
tracked table blocks automatic replacement. After investigating the decrease,
an operator can authorize that one run with `run --approve-count-drop`.

Document deletion first hides the row and records cleanup in PostgreSQL. Every
five minutes the worker retries eligible object removals. An object becomes
eligible only after a verified database snapshot contains that deletion. With
backups disabled, deleted objects remain private in R2 and continue using storage;
they are not removed merely because a fixed number of hours passed.

To stop publication, set `BACKUP_ENABLED=false` and recreate the worker. Startup
removes the recurring backup schedules; already queued backup jobs reject when
disabled. Keep the last archive and manifest intact. Re-enabling checks the
recorded identities before publishing.

For an EC2 move, first follow the restore and write-freeze procedure later in this
document. Restore the exact current manifest's archive, keep backups disabled,
stop the old writer, and set a new `BACKUP_WRITER_ID` on the new host. Run:

```bash
docker compose --env-file .env -f compose.prod.yml run --rm --no-deps -e BACKUP_ENABLED=false worker node dist/backup.js adopt PREVIOUS_WRITER_ID RESTORED_BACKUP_ID
```

Replace both placeholders with recorded IDs. The command checks installation,
archive ID, migration fingerprint and table counts, verifies the remote archive,
then conditionally transfers writer authority. If a response is lost, retry the
same command; do not delete the manifest to work around a conflict. Rotate the
API's `RECOVERY_EPOCH`, invalidate restored authentication sessions, and reconcile
offline pending work before opening writes and enabling the new backup worker.

## Agreed Deployment and Backup Policy

| Decision            | Required behavior                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Application host    | AWS EC2, with PostgreSQL 17 and Redis in the existing production Compose project                                                  |
| Schedule            | Every day at **02:00 Asia/Kolkata**; store timestamps in UTC                                                                      |
| Execution           | Existing separate worker process and BullMQ; one full-database backup at a time                                                   |
| Destination         | Dedicated **private R2 backup bucket**, separate from private documents and public APK downloads                                  |
| Retention           | Only the **latest successfully completed** database backup, plus its small manifest                                               |
| Safe replacement    | Temporarily keep the previous archive and the candidate; delete the previous archive only after verified publication              |
| Moving AWS accounts | Restore onto a fresh EC2 instance; retain the same private R2 document bucket and object keys                                     |
| Initial state       | Backup publication disabled on a fresh or restored host until the operator validates and enables it                               |
| Simplicity          | Small functions within the existing worker; no root scripts, new backup framework, extra scheduler service or Docker socket mount |

Daily backup means a failure just before the next successful run can lose almost
24 hours of changes; a failed or delayed run makes that window longer. This is a
daily recovery point, **not point-in-time recovery**. A planned migration uses an
additional final backup after stopping writes so it need not lose the day's work.

Latest-only retention cannot undo corruption, an unwanted change or a deletion
that is already present in the newest backup. It also cannot survive loss of the
backup bucket/account itself. Those are accepted limits of this policy, not
problems that checksums solve. Keep a separately downloaded migration copy until
the move is accepted; that does not add ongoing R2 archive history.

## What This Backup Contains

Use a full custom-format `pg_dump` of the **hisaab database**, without a firm,
table or `public`-schema filter. Preserve all application schemas, including the
Drizzle migration journal, sequences, constraints, functions and triggers.

| Included in the database archive                                                           | Kept separately                                                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| All users, credential accounts/password hashes, firms, memberships and settings            | `.env`, `api.env`, `worker.env`, `BETTER_AUTH_SECRET`, provider keys and signing credentials           |
| Parties, items, stock lots, openings, vouchers, postings, allocations and issued snapshots | R2 image originals, thumbnails and generated files; a database dump contains only their metadata/keys  |
| Loans, settlements, associates, commissions, imports, audit history and period controls    | Redis queue/cache/AOF files; recreate only appropriate jobs after recovery                             |
| Durable idempotency and operation/import receipts, sync tables and migration history       | PostgreSQL cluster roles/passwords/tablespaces, host configuration, Docker images and DNS/TLS settings |
| Ephemeral authentication tables if present in the full dump                                | Account access/MFA recovery and the independently retained deployment record                           |

PostgreSQL documents that `pg_dump` takes a consistent database snapshot during
concurrent use, covers one database rather than cluster globals, and supports
custom archives for restoration. Use a PostgreSQL **17 client** for this
PostgreSQL 17 installation; an older-major client cannot dump a newer server.
[PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

The archive is sensitive: excluding environment files does not remove password
hashes, personal details, financial information or potentially live session data.
Only the installation operator may access it. A firm owner is authorized for
their own firm, not for every user's database. Do not add a whole-database
download URL or signing endpoint to normal firm Settings.

The existing [firm JSON export](19-backup-recovery.md) has a different purpose.
It needs authenticated access to the original firm, creates a new firm with
remapped identities, and clears document object references. It is not the file
to use when rebuilding the installation on another EC2 instance.

## B01: Establish Ownership, Configuration and Restore Boundaries

Add an installation identifier shared by the database, backup namespace and
deployment record. Give each authorized backup host a distinct writer identifier.
Both are identifiers, not credentials. Preserve the installation ID during a
move; explicitly hand over the writer ID after the old writer has stopped.

Worker settings parsed by `src/backup/config.ts` when publication is enabled or
an operator command is requested:

| Setting                                                  | Purpose                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `BACKUP_ENABLED`                                         | Defaults to `false`; explicitly enable only the accepted installation                  |
| `BACKUP_INSTALLATION_ID`                                 | Selects this installation's namespace and guards against backing up the wrong database |
| `BACKUP_WRITER_ID`                                       | Matches the operator-approved writer recorded by publication state                     |
| `BACKUP_R2_BUCKET`                                       | Dedicated private backup bucket                                                        |
| `BACKUP_R2_ENDPOINT`                                     | R2 HTTPS S3 endpoint, including jurisdiction requirements if applicable                |
| `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` | Bucket-scoped server credentials; never sent to clients                                |

Use the worker's configured database connection. Derive region `auto` for R2 and
keep the schedule fixed at the agreed time initially. Avoid adding a settings
screen for every constant. Document bounded size/time limits with the eventual
implementation rather than silently accepting unlimited work.

Owner setup when implementation is ready:

1. Create a dedicated private R2 bucket. Leave public access and public custom
   domains disabled. Browser CORS is unnecessary for server-to-server backups.
2. Issue a key limited to that bucket's required object read/write/delete
   operations. Keep it in private worker configuration; the API and browser do
   not need this key. Retain independent operator read access for host-loss recovery.
3. Do not put an age-based expiry rule on the current archive or `latest.json`.
   Otherwise a missed schedule could expire the only usable backup. Stale
   multipart-upload cleanup may be configured without deleting completed archives.
4. Record how to recover Cloudflare access and configuration if the AWS account
   is unavailable. Save secrets through the existing private secret-management
   process, separately from the database archive.

Use HTTPS for every R2 operation and rely on R2's automatic, Cloudflare-managed
encryption at rest for this initial design.
[R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)
The PostgreSQL archive itself is not client-encrypted or password-protected:
a valid object-read key can download the usable, unencrypted archive. Keep
temporary and downloaded copies on encrypted EBS or encrypted, private
owner-controlled storage with restrictive file permissions. This plan adds no
custom encryption scheme.

Start disabled even when an old database backup contains an enabled/status row.
A database restore must not restore authorization to publish. Require a local
operator enablement decision and a writer match against R2 state. A foreign
installation ID, missing schema, incomplete migrations, empty user/firm tables
after a restore, or unexplained large drop in recorded counts must block
replacement pending operator review. Never replace known business books with a
newly initialized empty database merely because its health check succeeds.

**Acceptance:** fresh boot and restored configuration cannot overwrite an
existing backup; wrong installation/writer is rejected; normal firm users cannot
read or trigger whole-database backups; secrets never appear in logs or responses.

## B02: Capture and Verify a Bounded Database Archive

The [worker image](../deployment/Dockerfile.worker) must include a matching
PostgreSQL 17 dump/restore client, with its version and runtime libraries verified
in the built image. Installing an unspecified distribution `postgresql-client` package is
insufficient if it resolves to PostgreSQL 15. Do not install packages at startup
or call Docker from inside the worker.

The implementation separates source/ownership checks (`state.ts`), streamed
capture (`capture.ts`), R2 I/O (`storage.ts`), orchestration (`runner.ts`) and
host commands (`operator.ts`) under `apps/worker/src/backup`.

For each run:

1. Acquire a nonblocking PostgreSQL **session advisory lock** dedicated to
   installation backups, on a dedicated connection held until publication and
   cleanup finish. BullMQ concurrency one alone does not serialize two worker
   processes. If the connection/lock is lost, abort the child process and prohibit
   publication. Do not hold the ordinary firm posting lock for the whole dump.
2. Recheck enablement, installation identity, expected schema and writer authority.
   Coordinate migrations with backups: the existing deployment stops the worker;
   shutdown must abort/drain the backup before schema changes begin. Other manual
   maintenance must follow the same rule.
3. Create an owned temporary directory with mode `0700`, and a dump file with
   mode `0600`. Check available disk space before starting. Configure a measured
   maximum archive size and an overall deadline; fail explicitly when exceeded.
4. Spawn `pg_dump` with an argument array, custom format and no shell. Pass
   connection secrets privately, not in process arguments or logged command text.
   Stream output to the file with backpressure and count bytes; do not accumulate
   the database in a JavaScript string or buffer. Hash the exact archive bytes.
5. Bound connection/lock waits, process duration, stderr capture and upload I/O.
   Kill and reap the child on timeout, shutdown or cancellation, including a
   forced-kill fallback. Existing container shutdown grace periods must cover
   cancellation; they need not wait for an entire long backup to finish.
6. Require a successful exit and nonempty archive. Run bounded `pg_restore --list`
   and verify expected schemas/tables, including migrations and retry receipts.
   Listing proves archive structure, not that every record restores correctly.
7. Record start/finish times, client/server versions, release image SHA/digests,
   migration metadata and baseline counts. Identify whether counts come from the
   dump's snapshot or a separate preflight query; do not claim a shared snapshot
   unless implemented. Preserve the migration journal inside the archive itself.

Always clean only the run's owned temporary files in `finally`. On restart,
recover or remove abandoned temporary files by a known prefix/ownership record;
never recursively delete an arbitrary configured directory. Abort incomplete
multipart uploads after failure. A disk-full or provider outage must leave the
previous published backup usable and the API able to serve ordinary work.

**Acceptance:** real PostgreSQL 17 dump and fresh restore; bounded memory with a
larger synthetic database; disk-full, process failure, timeout, cancellation,
lost lock and restart cases; no lingering child, leaked temporary files or secrets.

## B03: Publish Only a Verified Replacement

Use this structure in the dedicated bucket:

```text
installations/<installation-id>/latest.json
installations/<installation-id>/archives/<unique-backup-id>.dump
```

The candidate's unique archive key becomes the retained archive; no rename or
second archive copy is required. Normal steady state is **one archive plus one
manifest**. Safe replacement temporarily needs two archives. A failed cleanup
can leave extra unreferenced candidates until the next verified cleanup; report
this honestly rather than sacrificing the current backup to enforce a count.

The manifest should have a versioned, strict schema containing:

- Installation ID, authorized writer ID, backup ID and canonical archive key.
- Archive byte length and SHA-256 of the exact uploaded bytes.
- UTC capture-start, capture-finish, verification and publication timestamps;
  scheduled occurrence or operator-requested reason.
- PostgreSQL server/client versions, application release SHA/image identifiers,
  migration count/latest entry and migration-history fingerprint.
- Data-coverage version, preflight/reference counts with their timing, and
  attachment coverage explicitly described as **metadata only**.
- Restore/verification status that distinguishes download/hash verification
  from a separately exercised full restore.

Do not include connection strings, credentials, signed URLs or row contents.
An ETag is an opaque conditional-write token, **not the archive's SHA-256**.

Publication order:

1. Read `latest.json`, validate it and remember its ETag and referenced archive.
   A missing manifest is a separately authorized first-backup case; an unreadable
   manifest is an error, not permission to initialize over it.
2. Upload the candidate to its unique key. Stream multipart uploads if required
   by size, using bounded buffers and retries. Never upload over the current key.
3. Download the candidate again and stream it through SHA-256 and a byte counter.
   Compare both with local values. A HEAD request or metadata checksum alone is
   not the required download verification. Inspect the downloaded archive as well
   when keeping a local verification copy; account for its disk use.
4. Recheck writer authority, source/recovery identity and the existing manifest.
   Record the in-flight publication attempt durably **before sending the PUT**.
   Publish the small new `latest.json` with **`If-Match` against the ETag read at
   step 1**. For an authorized empty namespace use **`If-None-Match: *`**.
   A precondition failure must trigger reconciliation, not an unconditional retry
   that overwrites another writer's result.
5. Read the manifest back and verify it selects this exact candidate. If the PUT
   response is lost, retain **both the candidate and previous archive** until that write
   is definitively settled or a conditional reconciliation makes it impossible
   for the ambiguous write to commit later. A timeout, aborted client connection,
   old manifest or even a strongly consistent 404 does not prove the PUT failed:
   it may still commit after that read. An unresolved attempt remains protected
   across restart; elapsed cleanup grace is not evidence of resolution. Keep it
   for operator review if reconciliation cannot establish the outcome. R2 state
   is authoritative if local status recording fails after publication.
6. Only now delete the previous archive. If deletion fails, retain the new current
   archive and report cleanup pending. Before retrying any deletion, re-read the
   manifest and ensure the object is neither current nor an active candidate.

R2 documents strong consistency for object reads/writes and atomic conditional
`PutObject` checks. These apply per object; uploading a dump and its manifest is
not a transaction across both keys. Conditional publication is what makes the
pointer switch safe. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/),
[R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

In particular, R2's [negative-read guidance](https://developers.cloudflare.com/r2/reference/consistency/#negative-reads-and-in-flight-writes)
does not let cleanup infer the final outcome of an earlier in-flight write from
a later read alone.

Use a conservative orphan-cleanup grace period longer than the maximum run time.
Delete only application-owned unreferenced keys in this installation's archive
namespace, while holding the same backup lock. A process that loses publication
authority must not clean another writer's objects. An uncertain result should
leave an extra object, not remove the recovery point. Never choose the latest
backup by filename or object modification time instead of the verified manifest.

**Acceptance:** inject failures before/after every publication step, including a
lost successful response and a PUT that commits after a 404/old-manifest read;
corrupt/truncate a candidate; run concurrent publishers; restart after pointer
publication but before cleanup. Every outcome must retain a
valid manifest/archive pair or the previous valid pair. A stale writer must not
replace the new host's backup.

## B04: Schedule, Catch Up and Report State

The supported `backup-database` job uses the existing worker and
`upsertJobScheduler` integration: stable daily scheduler ID, pattern `0 2 * * *`
and timezone `Asia/Kolkata`. Startup removes obsolete unsupported scheduler IDs.
The handler is configured only when backup publication is explicitly enabled.

A scheduler may run late when workers are unavailable or busy. Therefore:

- On enabled startup and periodically while running, find the most recent
  scheduled 02:00 occurrence and compare it with the last published capture.
- If overdue, enqueue **one** catch-up job. Deduplicate it with the scheduled job
  under the backup lock. Capture current data; do not invent historic snapshots
  for each missed day or launch a backlog of full dumps.
- If publication succeeded but its response/status update was lost, reconcile
  the manifest first. Retries must recognize that success.
- Remove/disable the schedule and reject already queued backup jobs when disabled,
  in recovery mode, or when writer authority changes. Do not rely only on removing
  the future scheduler.
- The existing 02:30 cleanup job may overlap a slow backup. Keep financial retry
  receipts durable and make attachment cleanup honor B05's backup boundary.

BullMQ's scheduler produces jobs as preceding jobs begin processing; a cron
definition alone is not proof of on-time backups.
[BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/)

Persist minimal status: disabled/running/failed/published, last attempt, last
published capture time, archive size/hash, failure category and cleanup pending.
An interrupted running state becomes interrupted/unknown until reconciled.
Successful process startup, queue insertion or archive listing must never set
"backup complete". Expose the next expected run, stale-backup warning and last
full restore-test date separately.

Make detailed status, job lists/job payloads and manual backup/handover actions
**installation-operator only**. Protected host access and sanitized worker
logs/status are sufficient for inspection; do not invent a public admin endpoint
or reinterpret a firm's owner role as installation administration. Ordinary firm
backup UI should continue to describe its separate JSON feature accurately.

### Deliver a Missed-Backup Alert Independently of EC2

Logs cannot notify the owner when the worker, Redis or EC2 instance is down. Before
enabling the schedule, configure one externally hosted heartbeat monitor, such
as [Healthchecks.io](https://healthchecks.io/docs/), rather than another container
or scheduler in this deployment. This monitor needs no database or R2 credentials.

Owner setup and implementation requirements:

1. Create a production backup check using cron `0 2 * * *`, timezone
   `Asia/Kolkata`, and initially a **60-minute grace period**. Confirm the service
   displays the expected next run. A successful daily backup is therefore due
   before 03:00 IST; adjust the grace only from measured runtime evidence.
   [Cron/timezone setup](https://healthchecks.io/docs/cron/)
2. Connect and verify the owner's email notification integration, select it for
   this check, and confirm a test alert is actually received. Keep this account
   accessible independently of AWS and do not expose the check or its ping URL
   in normal firm settings.
3. Store the secret success-ping URL only in private worker configuration. Add
   a bounded HTTP success ping **after B03 verifies the published manifest** for
   the current scheduled occurrence/catch-up. Never ping for startup, queued work,
   dump creation alone, or repeated inspection of yesterday's backup. Send no
   financial rows, credentials or object-download links to the monitor.
4. If ping delivery fails, record notification failure and retry within a bounded
   window. Do not roll back a valid published backup or falsely claim an alert
   was delivered. If timely success never arrives, the external monitor alerts
   even when the entire EC2 host is unavailable.
5. Rehearse a missed heartbeat with a short-lived synthetic check and a stopped
   test worker. Confirm the owner receives the failure and later recovery notices.
   Record the delivery evidence, not just a green monitor page. Activate the
   production check with a genuine verified backup before relying on it.

During account migration, retain this external check, transfer its private ping
configuration to the sole accepted writer, and explicitly resume any planned
maintenance pause. A website uptime check does not replace backup freshness
monitoring. **No heartbeat integration or alert delivery has been implemented or
tested by this documentation change.**

**Acceptance:** 01:59/02:00/02:01 IST boundaries, restart before/after the scheduled
time, multi-day outage, Redis state loss, duplicate jobs and disabled restored
host. One valid catch-up snapshot publishes; its timestamp and limitations are
clear. A stopped worker/host must produce an externally delivered missed-backup
notification, while ordinary firm users cannot inspect full-database jobs.

## B05: Preserve Document and Client Recovery Correctness

### Documents Need Their Own Retention Boundary

A 02:00 database backup can refer to a photo physically deleted from R2 at 03:00.
Restoring the database later does not restore that photo, even when using the same
bucket. PostgreSQL's consistent snapshot does not atomically snapshot R2.

The deletion path in
[`documents.service.ts`](../apps/api/src/modules/documents/documents.service.ts):
commits a document tombstone and durable cleanup task together before removing
bytes. Provider failures must not leave a live record whose file has disappeared.
Then defer physical deletion until a **later successfully published backup**
no longer references that object, or preserve its verified bytes in an independent
archive. A fixed 24-hour delay is insufficient when backups are failing.

Derive the deletion boundary conservatively from a verified snapshot/reference
manifest, not a misleading "job finished" timestamp. If exact reference coverage
is uncertain, retain the object. Stop deletion during migration or restore.
Include original and thumbnail keys, pending uploads, recovered keyless metadata
and abandoned candidates when deciding what is eligible for cleanup. Never apply
blanket expiry to the private `firms/` document prefix.

The selected account-migration policy reuses existing private R2 documents. It
does not independently protect against losing the Cloudflare bucket or deleting
its contents through the dashboard. Record missing files explicitly; do not mark
database metadata as recovered document bytes.

### Old Clients Must Not Replay Blindly After Restore

The audit identified that missing receipts after a restore could trigger blind
replay of uncertain pending entries. Server protection now checks
`X-Recovery-Epoch` before durable retry lookup and execution, including legacy
sync. Native/browser outbox protection preserves each request's original epoch;
see [Doc 31](31-implementation-and-verification.md) for integration evidence.
Locally known-success entries must still never be automatically replayed.

Use a recovery epoch managed at cutover, with a value that cannot itself rewind
with the restored database. On mismatch, browser and native clients must block
automatic queued writes, preserve original request keys and attachment files,
and require reconciliation before refreshing their local read/sync state. Bypass
must not be available through ordinary login. Session reset alone is insufficient:
logging in again can otherwise reconnect the same pending queue.

During restore and reconciliation, keep affected devices offline. Preserve
their pending drafts before any logout, reinstall, cache clearing or application
storage reset. Reconcile every uncertain save as described in
[manual recovery](20-manual-recovery.md#pending-saves-before-reconnection): matching
receipt plus matching entry permits controlled retry; a missing receipt alone
does not prove an entry should be created again.

**Acceptance:** delete after a backup then restore it; failures during object
cleanup; paused backups longer than 24 hours; a client with a committed save newer
than the restored snapshot; an uncertain save; an old sync cursor; retained image
drafts. Repeat uncertain-save recovery after a fresh login as the same user, firm
and role: missing receipts must not authorize automatic replay or bypass recovery
quarantine. Known-success entries remain preserved for reconciliation, not
automatically reposted. No missing evidence or duplicate entry may be silently
reported as success.

## B06: Rehearse, Enable and Maintain

Use synthetic books, a disposable PostgreSQL 17 target and a separate test backup
namespace. Do not restore over live books or test deletion using live document
keys. Cover multiple users/firms, GST/non-GST/mixed books, openings, purchases,
sales, receipts, returns, loans, settlements, commissions, imports, closed periods
and audit history. Verify retry responses survive database recovery.

Run a complete download/hash/restore drill, compare business totals and identity
relationships, and test original/thumbnail downloads against isolated synthetic
objects. Measure backup duration, restore duration, disk use and API latency while
the backup runs. Set bounded limits from those results. A small amount of ordinary
traffic must remain usable; streaming avoids memory growth but still consumes
database/disk/network capacity.

Record the exact release, server/client versions, migration fingerprint, archive
hash, recovery point and acceptance results. Enable only the intended host after
this evidence exists. Check the first 02:00 run and catch-up behavior. Repeat a
restore drill after material schema/storage changes and on a deliberate schedule.
These are focused acceptance checks, not a new permanent regression pipeline.

**Evidence available from the 26 October audit:** a synthetic API workflow and
PostgreSQL dump/restore retained two vouchers, balanced postings of 30,000 paise
on each side, and all 27 migration entries. Separate firm-JSON export, restore
and exact retry replay checks passed. These are limited local checks, not proof
of the daily backup service. Live R2 publication, replacement and retention were
not tested in that audit run. Later implementation evidence belongs in Doc 31.

## Owner Runbook: Move to Another AWS Account or EC2 Instance

Use this for an authorized account/host move. Keep service access and account
billing arrangements valid during the transition; do not wait for the old account
or volume to become inaccessible before obtaining the final backup and secrets.

### 1. Prepare the New Host Without Starting Writers

Follow [guide 26](26-ec2-and-expo-deployment.md) for EC2, Docker, storage and network
setup. Use the same CPU architecture, recorded PostgreSQL 17 release/image and
four application images first. Do not combine account migration with an
application or PostgreSQL major upgrade.

Copy the reviewed deployment files into **`/opt/hisaab`**, with the same layout:

```text
/opt/hisaab/
  compose.prod.yml
  Caddyfile
  chromium-seccomp.json
  .env
  api.env
  worker.env
  backups/
```

Transfer `.env`, `api.env` and `worker.env` securely and separately from the
database archive. Keep mode `0600`, never source them as shell scripts and never
print resolved Compose configuration into logs. Preserve `BETTER_AUTH_SECRET`;
also retain the original user credentials and firm memberships in the database.
Require fresh sessions after restore anyway. If the secret is lost or exposed,
plan explicit rotation and renewed authentication instead of assuming existing
signed data remains valid.

The target may use new PostgreSQL/Redis passwords because its volumes are new.
Keep database/user name `hisaab`; Compose supplies internal URLs from `.env`.
Preserve R2 document endpoint/bucket/keys and all public app/API origins. Backup
publication stays disabled, with a new writer ID awaiting handover. Keep the
worker stopped; copying an old enabled worker env file is not authorization.

Restrict SSH to approved operator/deploy addresses. Publish only the existing
web/TLS ports; never publish PostgreSQL or Redis. Set `DEPLOY_ENABLED=false` in
GitHub while moving. The new host needs verified SSH credentials/host key and
updated `EC2_HOST`, `EC2_USER`, `EC2_SSH_PRIVATE_KEY`, `EC2_KNOWN_HOSTS` plus any
runner/security-group adjustments described by guide 26.

### 2. Establish the Final Source Boundary

1. Tell every user/device to stop editing and uploading. Resolve known pending
   operations while the old system is still available; retain unresolved drafts
   and files offline. Record source totals and the cutover time.
2. Disable scheduled backup publication and automatic deployment. Stop the old API
   and worker, allow shutdown to finish, and verify no other writer or migration
   process is running. Keep PostgreSQL available for the final dump.
3. After B01-B06 exist, use the operator-only final-backup action with other job
   processing paused. It must use the same verified publication path. No command
   for this future action exists yet.
4. Today, the following **manual alternative** produces a private final dump with
   the existing PostgreSQL container. Run it only on the confirmed **old host**.
   It deliberately leaves API/worker stopped if anything fails.

```bash
(
set -euo pipefail
umask 077
cd /opt/hisaab
exec 9>.deploy.lock
flock -n 9
test ! -e .deploy-in-progress
test -s .env
compose=(docker compose --project-name hisaab --env-file .env -f compose.prod.yml)
timeout --kill-after=10s 120s "${compose[@]}" stop -t 90 api worker
mkdir -p -m 700 backups
backup="backups/migration-final-$(date -u +%Y%m%dT%H%M%SZ).dump"
timeout --kill-after=10s 600s "${compose[@]}" exec -T postgres \
  timeout -k 10 540 pg_dump -U hisaab -d hisaab --format=custom > "$backup.partial"
timeout 30s "${compose[@]}" exec -T postgres pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
sha256sum "$backup"
printf 'Final source archive: %s\n' "$backup"
)
```

The inner timeout bounds the process inside the container. Verify that utility
is present in the selected PostgreSQL image before the maintenance window. If a
command fails, inspect it; do not restart writers or reuse a partial dump as a
completed archive. Record the displayed hash through a trusted channel.

Copy the final dump through verified SSH or a privately configured R2-compatible
client. Download and hash the transferred copy. A manual
upload is simply a migration archive: do not claim it updated the managed manifest
or fulfilled the automatic backup schedule. Keep the old host stopped throughout.

### 3. Restore into Fresh Target Volumes

On the confirmed **new host**, save the verified archive as
`/opt/hisaab/backups/migration-final.dump`. For an automatic backup, fetch and
retain `latest.json` first, download only its canonical referenced key and
compare its SHA-256/size. For the manual alternative use the trusted source hash.
Never execute SQL or choose another remote URL/key supplied by an untrusted file.

The block below refuses an existing production database or Redis volume. It
starts only PostgreSQL and Redis and does **not** run migrations or seed data.
Replace the hash placeholder before running. It also invalidates restored
ephemeral authentication state, only in this newly created target database.

```bash
(
set -euo pipefail
umask 077
cd /opt/hisaab
test -s .env
test -s api.env
test -s worker.env
backup=/opt/hisaab/backups/migration-final.dump
expected_sha256=REPLACE_WITH_VERIFIED_64_CHARACTER_SHA256
[[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]
test -s "$backup"
printf '%s  %s\n' "$expected_sha256" "$backup" | sha256sum --check -
docker info > /dev/null
for volume in hisaab_postgres_data hisaab_redis_data; do
  if docker volume inspect "$volume" > /dev/null 2>&1; then
    echo "Existing target volume found; stop and review instead of overwriting it." >&2
    exit 1
  fi
done
compose=(docker compose --project-name hisaab --env-file .env -f compose.prod.yml)
timeout --kill-after=10s 180s "${compose[@]}" up -d --no-recreate --wait --wait-timeout 120 postgres redis
timeout 30s "${compose[@]}" exec -T postgres pg_restore --list < "$backup" > /dev/null
timeout --kill-after=10s 600s "${compose[@]}" exec -T postgres \
  timeout -k 10 540 pg_restore -U hisaab -d hisaab \
  --no-owner --no-privileges --single-transaction --exit-on-error < "$backup"
timeout 30s "${compose[@]}" exec -T postgres psql -X -U hisaab -d hisaab -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM public.session;
DELETE FROM public.verification;
DELETE FROM public.replaced_sessions;
DELETE FROM public.recovery_identity_tickets;
DELETE FROM public.invitation WHERE status = 'pending';
COMMIT;
SELECT count(*) AS migration_entries FROM drizzle.__drizzle_migrations;
SELECT count(*) AS users FROM public."user";
SELECT count(*) AS firms FROM public.organization;
SELECT count(*) AS memberships FROM public.member;
SQL
)
```

Review the ephemeral-table list against the recorded release before execution.
Keep users, `account` credentials, memberships, idempotency keys and durable
operation/import receipts. Pending invitations must be reviewed/reissued after
recovery. This reset requires fresh login; it does not change saved passwords.
For an older backup, also review password/role changes since that backup before
opening access, since obsolete credentials or permissions could return.

`--single-transaction --exit-on-error` makes restore fail together rather than
leave a partly applied archive. `--no-owner --no-privileges` uses the target
role; the Compose-created `hisaab` role must exist. Additional roles/grants, if
introduced later, need their own reviewed setup. Do not use `--clean`, seed,
disable triggers, or delete volumes to force a retry.
[PostgreSQL 17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)

If the block fails after creating volumes, leave the target isolated and inspect
it. The freshness guard will reject an automatic rerun; that is intentional.
Compare the restored migration journal with the archive's recorded release. The
current checkout has entries 0000-0026, but that number is not a permanent restore
criterion. Restore the matching version first, then plan upgrades separately.

### 4. Reconcile Clients, Documents and Jobs Before Exposure

Use the fresh target Redis volume; do not copy old BullMQ jobs or caches blindly.
Do not run `FLUSHALL` against either installation. PostgreSQL durable receipts are
the authority for financial retries. Recreate only reviewed PDF/reminder work
after accounting reconciliation, and leave backups disabled.

Validate with restricted operator access, using normal authentication when
checking business endpoints. `APP_MODE=recovery` exposes the existing restricted
identity-recovery flow; it is **not** a general read-only accounting mode. Normal
API validation must therefore stay inaccessible to ordinary devices until their
replay state is reconciled. For a test drill, use copied/synthetic R2 objects;
for the real move, read the existing private objects and avoid deletion tests.

| Pending state                                           | Required decision                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Matching receipt and business row restored              | Controlled retry with the original key; verify exactly one result                                      |
| Business row exists but receipt is missing or different | Block replay and investigate; do not invent a new key/receipt                                          |
| Neither is present                                      | Determine whether the write happened after the snapshot or never committed before authorizing re-entry |
| Upload reservation, object or thumbnail differs         | Preserve device bytes and reservation IDs; inspect before re-upload/confirmation                       |
| Old sync cursor/cache                                   | Preserve drafts, reconcile writes, then rebuild reads under the new recovery epoch                     |

Set a new `RECOVERY_EPOCH` UUID in `api.env` before reopening the restored API.
Keep uncertain devices offline until their saved work is reconciled. A fresh
login does not authorize replaying an entry from the previous recovery epoch.
Check all firms' identities/memberships, trial balance, balance sheet, profit and
loss, GST/non-GST/mixed totals, stock quantities/value, outstanding bills,
allocations, loans/commissions, period locks, audit history and issued snapshots.
Download representative originals/thumbnails and verify their bytes and links.
Confirm cross-firm and unauthenticated access remain denied.

### 5. Switch Traffic and Hand Over the Single Writer

Keep these origins unchanged:

- `https://hisaab.sajaldbansal.com`
- `https://app.hisaab.sajaldbansal.com`
- `https://api.hisaab.sajaldbansal.com`

The R2 download domain and private document bucket remain independent of the EC2
move. Update DNS records to the new host and remove obsolete IPv6 records if the
target does not serve them. Confirm the new security group, proxy/TLS certificate
issuance, HTTPS cookies and deep app links. An Elastic IP belonging to the old
account must not be assumed to belong to the new account automatically.

DNS propagation can send some clients to the old address. Keep the **old API and
worker stopped**, even if it briefly means maintenance responses for cached DNS.
Start the accepted API/web/proxy release only on the new host. Admit reconciled
clients, verify login and persistence, and restart the new instance once under
supervision to check service startup.

After restore acceptance, explicitly hand over the writer identity using the
`adopt` command's
conditional manifest update that preserves the existing archive reference. The
old writer must be rejected thereafter. Enable backups on the new host only,
publish and verify its first backup, then enable the 02:00 schedule. Resume other
worker jobs after review. Verify GitHub's new SSH host key/credentials and restore
`DEPLOY_ENABLED=true` only after the host and backup acceptance passes.

### 6. Handle Rollback Without Two Writers

If the target fails before accepting new business writes, stop its API/worker
first. Confirm its backup publisher is disabled and has not replaced the trusted
source with an invalid snapshot. The unchanged old installation can then be
deliberately reopened and DNS reverted after writer authority is restored.

If the new host has accepted writes, the old database is stale. **Do not simply
restart it.** Pause the new system, preserve a verified final copy and reconcile
or migrate the newer books before selecting the authoritative host. Application
rollback and database rollback are different operations; never restore an older
dump over new entries merely to undo a code release.

Keep old volumes stopped and intact until the migration and rollback decision
are accepted. Do not run `down --volumes`, volume pruning, a seed/reset, or an
automatic deletion of the old Compose directory/data. Stop unused resources to
control costs, then retire them deliberately after independent recovery access
and the new scheduled backup are verified.

## Completion Record

- [ ] B01-B06 implemented and focused acceptance checks recorded.
- [ ] 02:00 Asia/Kolkata schedule, one catch-up and disabled-host behavior verified.
- [ ] Independent missed-backup monitoring enabled; failure and recovery notifications actually received by the owner.
- [ ] Latest manifest selects a downloaded/hash-verified archive; obsolete cleanup is safe.
- [ ] Full restore tested; all users/memberships, books, migrations and durable receipts verified.
- [ ] Document deletion cannot invalidate the retained recovery point unnoticed.
- [ ] Secrets/account access are recoverable separately; restored sessions reset.
- [ ] Pending client writes/files reconciled; recovery epoch or explicit manual isolation recorded.
- [ ] Old writer stopped, new writer accepted, public HTTPS/DNS and GitHub host settings verified.
- [ ] First new-host backup and restart verified; actual loss/recovery windows recorded.

Record the operator, UTC cutover time, source/target instance IDs, release/image
versions, database versions, migration fingerprint, archive ID/hash/size, private
storage location, restore evidence, unresolved exceptions and next drill date.
Do not include secrets in this repository record.

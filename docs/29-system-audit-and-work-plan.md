# 29. System Audit and Ordered Work Plan

[Documentation index](README.md) | [Previous audit](27-private-readiness-audit.md) | [Database backup and EC2 migration plan](30-postgres-r2-backup-and-ec2-migration.md)

**Reviewed: 26 October 2026. Implementation completed and verified on 29 October 2026.**
The original reproductions below are retained as audit evidence. All 16 findings
(A01–A16) along with the Doc 30 backup/migration requirements (B01–B06) are now
fully implemented and verified via local integration, containerized rehearsal, and
acceptance test suites. Fixes, test suites, and exact passing evidence are tracked in
[Doc 31](31-implementation-and-verification.md); do not read the original defect
descriptions as a claim that every defect remains present in the latest code.

This review covers the current working tree based on commit `2404c08`, including
the uncommitted F01-F18 repairs and the deployment files. Five investigators
reviewed security, finance, clients, data recovery and infrastructure. Findings
were checked against the existing repairs rather than copied from the old audit.
The owner requested documentation first; no application, deployment configuration,
credentials or business records were changed during this review.

The hosting decision remains **one AWS EC2 instance running the applications,
PostgreSQL and Redis in Docker**. Oracle, managed PostgreSQL and managed Redis
are not part of this plan. Normal registration and multiple accounts/firms remain
supported even though one person currently uses the installation.

## Decision and Status

The main accounting workflow and all 16 identified actionable defects (A01-A16)
have been repaired and verified against PostgreSQL 17, Redis 7.4, and the full
multi-role HTTP and Playwright browser matrices. All local acceptance tests have
passed without regressions.

The application codebase is technically verified. Before production live deployment
as the sole authoritative copy of the books, the owner must complete the external
provider setup detailed in [Doc 30](30-postgres-r2-backup-and-ec2-migration.md) and
[Doc 31](31-implementation-and-verification.md) (provisioning the private Cloudflare
R2 backup bucket, enrolling credentials with `BACKUP_ENABLED=true`, configuring an
independent missed-backup alert, and running a physical mobile device check).

F01-F18 in Doc 27 remain repaired as previously recorded. Their completion does
not close these new findings. Use this document for the next repair sequence and
Doc 30 for the requested daily backup and future EC2/account move.

P1 means a high-priority access/integrity problem. P2 means a concrete defect to
resolve before relying on the affected workflow. P3 means lower urgency. All
findings have now been **verified resolved** in local integration suites (see Doc 31).
Source line numbers refer to this review's working tree.

## Checks Actually Performed

| Check                                   | Result                                                                                                                                        | What it establishes and what it does not                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh `bun run typecheck --force`       | 7 tasks passed                                                                                                                                | Type contracts for workspaces with a check command; not runtime correctness                                                                                  |
| Fresh `bun run lint --force`            | 7 tasks passed                                                                                                                                | Existing lint rules; no automatic fixes applied                                                                                                              |
| Fresh `bun run build --force`           | 4 tasks passed                                                                                                                                | API, worker, shared UI and Next.js production builds                                                                                                         |
| `bun run --cwd apps/native export:web`  | Passed                                                                                                                                        | Expo browser bundle; not a signed Android/iOS binary                                                                                                         |
| Fresh `bun audit --json`                | Same 8 advisory matches recorded in Doc 28                                                                                                    | Existing patch/exposure triage remains relevant; this is not a zero-advisory result                                                                          |
| Product website through Playwright      | 12 routes at both 1280px and 390px: HTTP 200, one main heading, no captured page exceptions or horizontal overflow                            | Rendering/layout checks; not a complete accessibility audit or live release-download check                                                                   |
| Expo app through Playwright (demo mode) | 72 static routes rendered in demo mode at 390px; no empty bodies, captured page exceptions or horizontal overflow; quick-create drawer opened | Includes forms, reports and access-required states; does not certify every authenticated operation, dynamic detail route or phone feature                    |
| Clean PostgreSQL installation           | All 27 migrations applied; second run succeeded                                                                                               | Disposable PostgreSQL 17, not the intended business database                                                                                                 |
| Real API workflow with synthetic data   | Signup, email verification using an in-memory sender, firm, customer, item, sale, allocated receipt, reports and firm export passed           | A non-GST item began with 10 units at Rs 100; sale of one unit for Rs 150 and its receipt left customer balance zero; trial balance Dr/Cr both 115,000 paise |
| Full PostgreSQL dump/restore            | Fresh target database retained 27 migrations and the two workflow vouchers; persisted posting debit/credit totals both 30,000 paise           | PostgreSQL portability and financial rows; no scheduled R2 backup, real R2 replacement, attachment-copy recovery or cross-account deployment was tested      |
| Role and auth reproductions             | Separate-account access denial and signup/verification passed; A01 reproduced across three mutation paths                                     | Synthetic authenticated requests and isolated PostgreSQL; no real mail sent                                                                                  |
| Financial reproductions                 | A02 and A03 reproduced in actual backend services and PostgreSQL                                                                              | Other combinations still need the acceptance matrix below; a core-only stock-count candidate was excluded because persistence correctly rejected it          |
| Import/export/restore reproduction      | Ordinary firm export/restore and replay passed; A10 reproduced after import and restore                                                       | Firm JSON is distinct from the whole-database archive                                                                                                        |
| Fault checks                            | A04/A11 reproduced with isolated failures; A05-A09 reproduced through lifecycle/form/transport logic; A12/A13 through local protocol stubs    | Physical-device behavior and provider outages were not reproduced                                                                                            |
| Infrastructure review                   | Seven workflow Bash blocks and static Compose invariants passed; A15 measured with synthetic metrics                                          | No EC2 rollout, public HTTPS, disk-exhaustion experiment or sustained capacity certification                                                                 |

The initial type/lint commands could not write logs because the session sandbox
still referred to the previous C: project location. Reruns in the actual
`E:\projects\7. Hisaab` workspace passed. This was an environment issue, not a
source defect. A temporary demo export used a separate output directory and a
cleared Metro cache; the normal export was not converted to demo mode.

No real account, customer email, document object or financial record was used by
these tests. Temporary audit servers, the isolated browser session, generated
demo files and disposable database resources were removed after verification.
The normal Expo export/cache was rebuilt using the existing local configuration.

## Confirmed Defects

### A01 - P1: Supplier writes bypass sales-role restrictions

**Evidence:** [party routes](../apps/api/src/modules/masters/parties.routes.ts),
line 24; [operation permissions](../apps/api/src/modules/operations/operations.schema.ts),
line 66; [sync mutation permissions](../apps/api/src/modules/sync/sync.service.ts),
line 307.

Sales staff are allowed either `sales` or `purchase` permission for every party
write. The service does not receive the actor's role. In actual authenticated
requests, a sales user created a supplier (201), could not read it (403), changed
its opening payable from Rs 100 to Rs 200 (200), and deleted it (200). Durable
operations and legacy sync also accepted supplier creation.

**Repair:** centralize authorization at the party write service. Check both the
existing and requested party types, including type conversion, across direct,
durable-operation and sync paths. Supplier writes require purchase rights.

**Acceptance:** sales staff can maintain permitted customers but cannot mutate
suppliers through any path. Rejection changes no balances, rows, versions or
retry receipts. Owner/accountant supplier workflows continue to work.

### A02 - P2: Partial-return cancellation overstates restored stock cost

**Evidence:** [shared `createNote`](../packages/core/src/mock/db.ts), lines 1362-1367.
Despite its historical filename, this shared calculation is used by the backend.

Purchase three units with total acquisition cost 100 paise, then sell all three.
Return one unit twice: costs are 33 and 34 paise. Cancel the first return and
return the remaining two units separately. Active returns restore
`34 + 34 + 33 = 101` paise. Actual persisted stock becomes three units worth 101
paise, and final accounts show one paise profit although all sales were returned.

**Repair:** subtract actual costs restored by surviving posted notes, not the
theoretical rounded cost of the previously returned quantity. Allocate the exact
remaining cost on the final return, preserving previously issued notes.

**Acceptance:** cancellation orders, fractional quantities and both stock books
restore exactly the issued cost; full return leaves expected net sales, COGS and
profit; subsequent resale consumes the corrected value. Review already affected
books explicitly rather than silently rewriting historical documents.

### A03 - P2: Backdated refunds reuse credit exhausted on an intervening date

**Evidence:** [settlement creation](../apps/api/src/modules/settlements/settlements.service.ts),
lines 427-437.

Record customer advance Rs 100 on October 1, refund Rs 100 on October 5, and a
second advance Rs 100 on October 10. A second refund dated October 2 is accepted
because capacity is checked only on its date and today. The October 5 balance
then becomes Rs 100 receivable without any sale or other debt.

**Repair:** check capacity at every subsequent balance-changing date in the
selected book through today, using the same temporal principle as the existing
loan-interest payment guard. Retain firm locking and retry identities.

**Acceptance:** reject the sequence without inserting a journal/receipt; cover
supplier refunds, reversals, replenishing advances and GST/non-GST partitions.

### A04 - P2: Diagnostic errors disclose bound database values

**Evidence:** [API error handler](../apps/api/src/plugins/errors.ts), line 56;
[shared reporting](../packages/backend/src/lib/observability.ts), lines 18 and 54;
[HTTP log redaction](../apps/api/src/app.ts), line 109.

A synthetic Drizzle/PostgreSQL failure returned a correctly generic HTTP 500,
but both diagnostic entries contained the supplied bound value. Error messages,
stacks, `query` and `params` can carry contact, credential or financial values.
HTTP-header redaction does not remove them. The Sentry path forwards the original
exception; its actual external payload was not sent during this check.

**Repair:** use one safe serializer for logs and error reporting, including nested
causes/messages/stacks. Keep SQLSTATE, safe error class and request/route IDs.
Review the authentication library's separate logging path as well.

**Acceptance:** injected password/token/email/financial markers never occur in
captured logs or mocked reporting payloads; safe diagnostics remain useful.

### A05 - P2: Brief native backgrounding removes the open form

**Evidence:** [AppState handling](../apps/native/src/auth/AuthProvider.tsx), line
289; [protected routes](../apps/native/app/_layout.tsx), lines 59 and 114;
[attachment scope checks](../apps/native/src/documents/useEntryAttachments.ts), line 56.

Inactive/background events immediately set `locked=true`. Navigation redirects
to the lock screen and removes the protected form before the configured timeout
is evaluated on return. A simulated short background interval produced
`true -> false`, so unlocking does not recover that component's local draft.
Camera/gallery handoffs that background the application can encounter this path.

**Repair:** separate temporary privacy concealment from an actual PIN/navigation
lock; retain the form or persist its draft across a real lock.

**Acceptance:** on the intended phone, retain fields and attachments after brief
backgrounding and camera/gallery selection, while still concealing books and
enforcing expired PIN locks. The physical-device reproduction remains required.

### A06 - P2: New invitees cannot reach invitation acceptance

**Evidence:** [empty-firm route guard](../apps/native/app/_layout.tsx), line 62;
[invitation UI](../apps/native/app/settings/account.tsx), line 52.

A signed-in account with no memberships is redirected to `/firms`, including
when it tries to open the account page containing invitations. The firm page has
no acceptance action. A new colleague must create an unrelated firm to escape
this route restriction. The actual route-guard logic reproduced the redirect.

**Repair:** allow account/invitation access without a selected firm, or display
invitations on the empty-firm screen. Refresh the provider's `firm-selection`
query after acceptance.

**Acceptance:** a new account accepts its invitation and enters the firm without
creating another one; account management and logout remain reachable with zero
memberships. Verify rejection, expired invitation and changed membership too.

### A07 - P2: Invoice editing rebuilds saved units/tax from current masters

**Evidence:** [invoice initialization and preview](../apps/native/src/forms/InvoiceForm.tsx),
lines 174 and 273; [permitted item edits](../apps/api/src/modules/masters/items.service.ts),
line 188.

Save a purchase using two Boxes, then rename the item's alternate unit to Pack
without changing its factor. Editing the old purchase submits Pack and the
snapshot-aware update rejects it. Current GST-rate changes can similarly alter
the preview even when the backend preserves the issued rate. This is not a
claim that removing an in-use alternate unit is allowed; that change is blocked.

**Repair:** initialize existing lines from saved `per`, tax details and issued
snapshots. Use current item masters for newly selected lines.

**Acceptance:** permitted item-master changes do not prevent an unrelated old
invoice edit or change its displayed financial basis. Cover purchases, sales,
discounts, alternate units and both book scopes.

### A08 - P2: Downloaded books omit the default P&L request

**Evidence:** [offline warmup](../apps/native/src/data/offlineWarmup.ts), line 61;
[P&L request](../apps/native/app/final-accounts.tsx), line 47.

Warmup caches undated `finalAccounts(tax)`, but the default Profit & Loss screen
requests explicit financial-year dates. Offline answers use exact normalized
request keys. An actual in-memory warmup/transport check completed the download,
then failed that P&L read offline while the undated Balance Sheet read worked.

**Repair:** share the screen's request builder and cache the explicitly supported
dated P&L periods. Do not silently substitute different dates.

**Acceptance:** after downloading books, the already-loaded app can open default
P&L and every promised period in mixed, GST and non-GST views without networking.

### A09 - P2: Interrupted response bodies bypass offline handling

**Evidence:** [client transport](../apps/native/src/auth/api.ts), lines 72-95.

Only initial `fetch()` is inside the network-error handler. If the connection
drops while `response.text()` reads the body, a raw error escapes and cached
reads are not selected. A seeded dashboard cache reproduced this failure.
Requests also have no application deadline/abort signal.

**Repair:** bound and classify both request and body consumption. For writes,
retain the original identity and distinguish an unknown committed outcome from
a confirmed rejection; timeout is not proof the server did not save.

**Acceptance:** disconnect before/after headers and during the body; cached reads
work when authorized, stalled requests settle, and uncertain writes remain
recoverable without creating duplicate financial entries.

### A10 - P2: Opening-stock import exceeds the item response contract

**Evidence:** [opening validation](../apps/api/src/modules/imports/imports.financial.validation.ts),
line 339; [import persistence](../apps/api/src/modules/imports/imports.financial.repo.ts),
line 253; [item contract](../packages/contracts/src/items.ts), line 62.

Importing 201 unique opening lots for one previously empty item passes preview
and apply. Normal item responses permit at most 200, so the actual item-list
route subsequently returns HTTP 500. Firm export/restore can reproduce that
unreadable item. The check used a fresh unregistered firm with no posted activity.

**Repair:** share a consistent lot limit across import, item reads and restore,
and provide a readable/recoverable path for already oversized items.

**Acceptance:** cover 200, 201 and 500 lots for one item, plus 500 rows distributed
across items within the supported limit. Invalid imports fail before mutation;
existing records and restored firms cannot silently become unreadable.

### A11 - P2: Failed document deletion leaves live metadata without bytes

**Evidence:** [document removal](../apps/api/src/modules/documents/documents.service.ts),
lines 343-348; [R2 object removal](../apps/api/src/lib/storage.ts), line 307.

R2 deletion happens before the database tombstone commits. Adapter fault checks
confirmed that a later database failure leaves ready metadata referencing a
deleted file. Sequential thumbnail/original/staging deletion can also partially
complete and fail before the database change. PostgreSQL rollback cannot restore
objects deleted from R2.

**Repair:** commit the tombstone and a durable cleanup task together, then delete
bytes through retryable processing. Coordinate physical deletion with the files
referenced by the currently retained database backup; see Doc 30.

**Acceptance:** database failure preserves bytes; each remote failure is
retryable after restart; repeat deletion is safe; retained backups do not depend
on files that cleanup has already removed.

### A12 - P2: Normal Redis calls have no response deadline

**Evidence:** [normal Redis client](../packages/backend/src/lib/redis.ts), line 5;
[rate-limit use](../apps/api/src/plugins/rate-limit.ts), line 80.

A local protocol stub accepted a connection, then withheld replies. Six requests
to a synthetic Fastify route using the real rate-limit plugin, and six direct
Redis commands, remained pending after 1.6 seconds while Redis reported `ready`.
Only connection establishment/retry count is bounded in this client; those do
not impose a command deadline on an established connection. The separately
bounded readiness and queue-producer clients do not fix this path.

**Repair:** bound normal commands and dispose of stalled connections. Keep
BullMQ's blocking consumer connections separately configured.

**Acceptance:** established-connection stalls fail within a specified deadline,
requests do not accumulate indefinitely, and service recovers after reconnection.
Authentication limits must fail closed; dependency failure must not bypass
password or OTP quotas.

### A13 - P2: Ordinary PostgreSQL work can occupy the entire pool

**Evidence:** [application pool](../packages/backend/src/db/client.ts), line 13;
[API startup](../apps/api/src/server.ts), line 15.

A protocol-stub check submitted eleven queries through the application pool
factory: ten connections remained occupied and one query was queued after
1.5 seconds. This was a pool check, not eleven HTTP requests. The ordinary pool
has no default acquisition/query deadline;
the separate readiness pool correctly timed out. Readiness failure does not
release application queries or establish whether a financial write committed.

**Repair:** define acquisition, server statement and lock deadlines, with
explicit bounded allowances for exports/imports and other long operations.
Include a client-side query/network deadline that discards stalled connections;
server deadlines alone cannot release a client waiting on a blackholed socket.
Cancel/rollback work and release connections; a JavaScript timeout alone is not
sufficient. Preserve durable result lookup for ambiguous write outcomes.

**Acceptance:** blocked locks and stalled queries release the pool; failed writes
do not continue unnoticed; permitted long work still completes and retries remain
idempotent. Test PostgreSQL-side cancellation, not just an HTTP timeout.

### A14 - P2: Deployment can fill the database disk before backing it up

**Evidence:** [image pull](../.github/workflows/deploy.yml), line 190; the local
pre-migration backup occurs later, around line 224. The manual update follows the
same order in [guide 26](26-ec2-and-expo-deployment.md).

The workflow pulls images while writers remain active without checking disk
headroom. Cached image virtual sizes were API 3.07 GB, worker 4.14 GB, website
3.15 GB and app 98.1 MB; shared layers mean these must not simply be added as
incremental release size. Old releases and dumps can exhaust the documented
50 GiB host filesystem also used by PostgreSQL/Redis. Disk exhaustion was not
deliberately induced in this review.

**Repair:** check Docker/data/backup filesystem headroom before pulling, again
after pulling before pausing writers, and before the dump. Define bounded
image/local-dump retention, preserving the running and
accepted rollback releases. Never prune database volumes. Keep runtime-image
slimming a separate measured improvement, not a prerequisite refactor.

**Acceptance:** low-space rollout stops before pulling or pausing writers;
cleanup cannot delete business data; enough space remains for database growth,
the candidate image layers and temporary backup files.

### A15 - P3: Every response sorts all route timings for metrics

**Evidence:** [response hook](../apps/api/src/plugins/observability.ts), line 74;
[metric aggregation](../apps/api/src/lib/metrics.ts), line 111.

Each response calls the full metrics snapshot to check alerts. Three percentile
calculations sort each route's timings separately. With 120 synthetic routes and
1,000 timings per route, a Node 24.20.0 microbenchmark took 34.1-35.5 ms per call,
synchronously. This is not a measured EC2 request-latency claim.

**Repair:** calculate periodically or only for the affected route, sort once,
and retain bounded storage and alert cooldowns.

**Acceptance:** normal/health responses avoid full aggregation; metrics remain
correct and the synthetic benchmark demonstrates reduced blocking work.

### A16 - P2: Website offline-startup guidance contradicts the application

**Evidence:** [architecture copy](../apps/web/content/handbook.ts), line 127;
[help copy](../apps/web/content/help.ts), line 171;
[retired shell worker](../apps/native/public/offline-worker.js), line 9.

Website text says the deployed Expo app caches its shell and implies that only
development lacks offline startup. The current export does not register that
shell worker; the retirement worker removes previous caches. A user can download
books, close the browser offline and be unable to reopen them. Existing cached
financial data is not necessarily lost. Guide 17 already describes the limit.

**Repair:** correct both passages to distinguish an already-loaded offline app
from opening/reloading without a connection. Offline cold-start support is a
separate optional feature, not a hidden promise of this repair.

**Acceptance:** website, help and release documentation describe the same limits.

## Business and Product Coverage

| Area                                   | Existing capability                                                                | Required next work or evidence                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Firms, identity and team               | Verified accounts, platform sessions, memberships and roles                        | A01, A04, A06; deployed cookies/takeover/recovery checks; zero-member onboarding                                                                       |
| Sales, purchases and receipts/payments | Posted vouchers, allocations, corrections, historical snapshots                    | A02, A03, A07; representative accountant-approved sample books                                                                                         |
| Capital, loans and journals            | Account groups, financing journals, schedules, reviewed interest                   | Retest accrual/payment/reversal and repayment references after the fixes; no automatic interest posting requested                                      |
| Associates                             | Delivery details, commission accrual/payout/reversal                               | Check actual print output, discounted pre-GST/pre-freight basis and concurrent payouts cannot overpay and identical retries return the original result |
| Stock and orders                       | GST/non-GST lots, split sales, returns, adjustments and partial fulfillment        | A02, A07, A10; lot conservation and order/delivery/invoice history across corrections                                                                  |
| Reports                                | Trial balance, P&L, balance sheet, ledgers/registers, CSV/PDF and book scopes      | A02/A03 affect correctness; A08 affects offline access; reconcile dates, scope, signed balances and download totals                                    |
| GST                                    | Basic summaries and GST/non-GST/mixed bookkeeping                                  | Verify arithmetic/partition labels; tax filing, e-invoicing and statutory advice remain outside scope                                                  |
| Images and documents                   | Multiple attachments, compression, thumbnails, filters, temporary private links    | A05/A11; real camera/share/low-storage checks; retained-file recovery requirements in Doc 30                                                           |
| Offline and retries                    | Encrypted cached answers, pending operations and durable result records            | A05/A08/A09; restored-server reconciliation; real restart/multiple-tab/low-storage acceptance                                                          |
| Imports and firm exports               | Validated master/opening imports and new-firm restore                              | A10; exports contain metadata, not image bytes or installation identities                                                                              |
| Reminders                              | Due calculations, preparation and user-controlled sharing                          | Verify recipient/amount; do not claim automatic WhatsApp delivery or a verified phone number                                                           |
| Deployment                             | Separate API/worker, four application images, Caddy and persistent local databases | A12-A15; live EC2/TLS/email/backup alerts, resource measurements and retention                                                                         |
| Website and accessibility              | Product/help/privacy pages and responsive layouts                                  | A16; keyboard/focus/screen-reader review is still unperformed; no claim of legal or accessibility certification                                        |

Human consequences matter alongside arithmetic: a historical refund error can
lead to an unjustified collection demand; a missing draft can encourage duplicate
entry; an old backup can revive a revoked membership. Show posted, pending,
rejected, unknown and recovered states separately. Confirm recipients before
sharing bills/reminders. Keep login accounts distinct from delivery/commission
profiles and equity partners.

Keep customer contacts, images, logs and full backups private. An installation
operator's access to the entire database is broader than a firm's owner role.
Document support/retention decisions before inviting other businesses. This pass
does not add public-SaaS marketing consent flows, subscriptions or legal claims.

## Requested Backup and Migration Work

**Implemented in the worker; provider acceptance pending:** at **02:00 every day in
`Asia/Kolkata`**, create a whole PostgreSQL backup and publish it to a separate
private R2 backup bucket. Retain only the latest successfully completed archive.
The previous one must survive any failure before the replacement is verified and
published. Brief temporary overlap is required for safe replacement.

Use [Doc 30](30-postgres-r2-backup-and-ec2-migration.md) for B01-B06, the exact
scope, proposed configuration, publication protocol, document retention, restore
checks and EC2/account cutover. The worker now accepts the backup job, has a
matching PostgreSQL 17 client, and performs daily, startup and missed-run checks.
Publication remains disabled until the operator configures and enrolls the
dedicated private bucket. The original audit preceded these changes; see
[Doc 31](31-implementation-and-verification.md) for current test evidence.

One daily copy is not point-in-time recovery: a failure shortly before the next
successful backup can lose about a day's work, or longer if backups have failed.
Latest-only retention also replaces evidence of older mistakes. For a planned
move, stop writes and take a **final** backup; do not use last night's copy while
continuing to enter transactions on the old host.

The database archive is portable between authorized AWS accounts. It does not
move an EC2 machine, DNS, env files, AWS permissions, Redis jobs, signing keys or
R2 bytes. Keeping the same private document bucket avoids an unnecessary file
move, but hard-deleted files still cannot be recovered from database rows.

## Implementation Order

Start each change from a recorded working-tree/release baseline and a verified
backup of any real database to be changed. Use synthetic reproductions first.
Do not add a large regression pipeline or a root scripts framework; focused
checks can exercise the existing functions and isolated services.

1. **A01:** close supplier-write authorization in all entry points.
2. **A02, then A03:** repair returned stock cost and dated refund capacity; add
   focused accounting regressions and identify whether existing books need review.
3. **A04:** prevent sensitive error values from reaching logs/reporting.
4. **A05, then A06:** retain phone drafts and make first-time invitations usable.
5. **A07, A08, A09:** preserve saved invoice bases and fix offline request/cache
   behavior. Verify response-loss and ambiguous writes with original retry keys.
6. **A10:** align opening-import and restore constraints without hiding existing
   oversized records.
7. **A11:** make document deletion durable/retryable and define backup-aware
   physical cleanup. This is a dependency of complete recovery.
8. **A12, A13, A14:** bound dependency waits and add deployment/storage headroom
   checks before relying on an unattended worker or rollout.
9. **B01-B06 in Doc 30:** implement daily R2 backup, observable failure states,
   safe publication, controlled restore/reconnection and migration rehearsal.
   Keep automatic publication disabled on a fresh/restored host until accepted.
10. **A15 and A16:** remove avoidable metrics work and correct website claims.
11. **Deployed acceptance:** complete the checklist below; record exact images,
    migrations, provider configuration and any deliberately accepted limits.

Independent repairs may run in parallel, but integration must preserve the same
role, locking, version, idempotency and snapshot rules. A task is complete only
when its acceptance scenario passes and this report records the result.

## Final Acceptance Still Required

- Run the repaired financial examples through actual HTTP routes and restart:
  GST/non-GST purchases of one item at different costs, selected-lot split sale,
  allocated receipt, advances/refunds, partial returns/cancellation, stock count,
  ledger journals, period locks, loan accrual/payment and commission payout.
- Reconcile quantities, carrying values, party balances, trial balance, P&L,
  balance sheet and exported reports. Additive mixed-book totals must equal
  their two components; ratios and other nonadditive measures need their own rule.
- Test owner/accountant/sales/viewer and a separate account across direct writes,
  durable operations, sync, documents and report reads. Keep registration open to
  intended users without hardcoding a single owner email.
- Use a real phone for PIN timeout, camera/gallery, multiple images, local draft
  preservation, secure storage, sharing, restart, network interruption and low
  storage. A 390px Chromium window is not an Android/iOS test.
- Verify actual EC2 HTTPS, proxy/cookies, email delivery, private R2 access,
  sandboxed PDF generation, worker restart and stale-backup alert delivery.
- Restore the latest R2 archive to an isolated fresh host/database, verify file
  references and pending-client behavior, then rehearse the planned final-copy
  cutover with only one writable installation. Record recovered-through time,
  duration and missing operations/files explicitly.
- Measure representative annual books on the chosen EC2 size: response/report
  p95, event-loop delay, memory peaks during PDF/backup, disk headroom and queue
  delay. Existing caches are useful; avoid caching cross-firm or stale authority.
- Keep one accepted release record: commit/image tags, schema version, backup
  identity/hash, private configuration recovery location, operational owner,
  phone/APK version and documented rollback/cutover decision.

No source review can establish that every future input, provider failure or
financial scenario is correct. This report separates reproduced defects from
checks still needed so completion can be assessed from evidence.

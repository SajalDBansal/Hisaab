# 27. Private-Use Readiness Audit

[Documentation index](README.md) | [Completion plan](24-completion-plan.md)

**Audit date: 25 October 2026. Intended release: one owner using their own books.**

**Follow-up, 26 October:** the [new system audit](29-system-audit-and-work-plan.md)
records additional open findings after the F01-F18/G-phase repairs below. Read
it for the current implementation order. The requested daily 02:00 India-time
PostgreSQL backup to R2 and EC2/account migration are planned in
[Doc 30](30-postgres-r2-backup-and-ec2-migration.md). Their later implementation and
verification are tracked in [Doc 31](31-implementation-and-verification.md). This document
retains the earlier evidence; its local completion notes are not an all-clear
for the subsequent review.

**Scope clarification, 26 October:** one person is using the app today, but it
remains a multi-user accounting product. Registration must not be tied to one
hardcoded person or email. The original G01 owner-only proposal is superseded;
registration, account recovery and firm isolation remain required.

Reviewed the working tree based on commit `2404c08`, including the existing
uncommitted documentation. The original audit did not change application source,
credentials, migrations or business records. Dated implementation notes below
record subsequent repairs; other findings remain open unless explicitly noted.
The original observations and reproductions remain below as the audit baseline;
they do not describe the status of a finding marked fixed.

## Decision

**Do not yet make this installation the only authoritative copy of your books.**
As of 26 October, F01-F18 are repaired and locally checked. G01 registration/firm
isolation and G02 dependency repairs/triage are complete locally; G03 production
R2 CORS is verified. G04 deployment files and runtime fixes are supplied, and G05's
isolated database/object restore rehearsal passed. The remaining release work is
operator configuration and deployed acceptance: EC2 PostgreSQL/Redis, email, AWS/
Docker Hub/HTTPS, retained independent backups, provider recovery and the actual
phone/offline workflow. Local checks are not a production deployment certification.

The subsequent review adds application repairs in Doc 29 before the operator
setup and acceptance in guides 25-26. More product pages,
languages, GST filing integrations, subscriptions or a general-public launch are
not needed for your first private release.

Use this report's sequence before the broader deployment plan in guides 24-26.
The public website and public APK distribution in those guides are optional for
this release. Preserve firm isolation and authentication even with one user: a
private intention does not restrict who can reach an internet-facing API.

## Original Audit Checks — 25 October

| Check                                                      | Result                                                                 | Boundary of the evidence                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Locked dependency installation                             | Passed after repairing an incomplete Windows package copy              | Lockfile and package declarations unchanged; initial missing React Native types were installation failures, not source defects          |
| `bun run typecheck --force`                                | 7 tasks passed                                                         | Workspaces with a typecheck command; does not execute financial workflows                                                               |
| `bun run lint`                                             | 7 tasks passed                                                         | Existing lint commands, without automatic fixes                                                                                         |
| `bun run build`                                            | 4 tasks passed                                                         | API, worker, shared UI package and Next.js website                                                                                      |
| `bun run --cwd apps/native export:web`                     | Passed                                                                 | Production browser bundle; not an Android/iOS binary                                                                                    |
| Website through Playwright                                 | 12 linked pages returned 200; no captured page exceptions              | Main heading and page rendering, report example toggles, and 390px horizontal-overflow checks                                           |
| Expo app through Playwright                                | Home plus 62 routes rendered in demo mode; no captured page exceptions | Screen/form shells and access-required states; not proof of connected features or successful saves                                      |
| Home interactions                                          | GST/non-GST tabs and New Sale navigation worked                        | Demo data only                                                                                                                          |
| Production Expo export startup                             | Redirected to a rendered login screen                                  | Backend unavailable; expected failed session request, no real login attempted                                                           |
| Accounting baseline checks                                 | 27 synthetic assertions passed                                         | Covered balanced postings, scope additivity, ordinary full returns, loan schedules and commissions; edge-case failures are listed below |
| Focused defect checks                                      | Core-function, fault-injection and in-process HTTP reproductions       | No business database writes; native storage tests used simulated failures                                                               |
| R2 signed `HeadBucket`                                     | HTTP 200                                                               | Configured credentials can reach the bucket; no object contents listed                                                                  |
| R2 upload preflight: `http://localhost:8081`               | HTTP 204 with matching allowed origin                                  | OPTIONS only; no file uploaded                                                                                                          |
| R2 upload preflight: `https://app.hisaab.sajaldbansal.com` | HTTP 403 without allowed origin                                        | Production browser origin is not currently usable for this upload request                                                               |
| `bun audit`                                                | 31 advisory matches: 4 critical, 6 high, 13 moderate, 8 low            | Dependency matches, not 31 demonstrated exploits; see G02                                                                               |

The website pages were `/`, `/features`, `/system`, `/accounting-principles`,
`/help`, `/downloads`, `/get-started`, `/security`, `/architecture`, `/privacy`,
`/about` and `/contact`.

App navigation covered lists, reports, accounting, GST summaries, banking,
documents, settings, imports, recovery, offline status, entry forms, associates,
loans and settlements. Screens requiring a connected owner correctly showed
that requirement in demo mode. Parameterized detail/edit pages and every form
submission were **not** exhaustively exercised. The GSTR-1 empty-state wording
was separately reproduced with a valid month parameter.

### Runtime gaps recorded on 25 October

The 26 October verification below supersedes the database, authentication and
R2 test limitations for the specific cases exercised. Other gaps remain open.

- Docker's Linux engine was unavailable. PostgreSQL on port 55432 and Redis on
  port 16379 refused connections. No API or worker was already serving locally.
- API environment metadata still identifies local database/Redis endpoints and
  development defaults. `apps/worker/.env` is absent; the worker intentionally
  does not load `apps/api/.env`.
- Therefore migrations, constraints under real concurrency, real authentication,
  all HTTP endpoints, PDF jobs, persistence after restart and database restore
  remain unverified. A successful build does not establish these results.
- No Android/iOS device, camera, native secure storage, app signing, browser
  eviction, full offline/reconnect cycle or installed APK upgrade was tested.
- R2 object upload/confirmation, thumbnails, signed downloads, deletion and
  restored attachment bytes were not tested. The read-only checks above do not
  establish complete document functionality or prove bucket privacy settings.
- No cloud deployment, provider backup policy, certificate or Linux container
  was inspected. Dockerfiles, Compose and CI/CD remain planned, not supplied.

The isolated browser and all three temporary frontend servers were stopped.
Ports 3002, 8081 and 8091 were checked closed on IPv4 and IPv6 loopback.

## Repair Verification — 26 October

Five agents worked at a time on separate findings, followed by integration and
connected checks. No real business database or user account was changed. Database
tests used a disposable PostgreSQL 17 instance and synthetic firms/accounts.
No CI pipeline, permanent test framework or root scripts folder was introduced.

| Check                            | Result and boundary                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace types, lint and builds | Seven typecheck tasks, seven lint tasks and four builds passed; Expo web export also passed.                                                                                                                                                             |
| F02-F06 financial transactions   | Nine PostgreSQL scenarios passed: customer/supplier refunds, exact partial returns at 0%/18%, landed-cost return, later settlement conflicts and dated interest reversal.                                                                                |
| F07-F09 readers/conflicts        | Actual stored opening dates, imported-bill reminders and protected-import HTTP 409 responses passed; focused core/HTTP checks cover further partitions.                                                                                                  |
| F11 authentication               | Actual Better Auth login, confirmed takeover, five concurrent takeovers, old-session rejection and separate phone/browser slots passed.                                                                                                                  |
| F10/F15 native reliability       | Fault simulations passed: secure storage/PIN/logout/restarts and delayed/failed/concurrent preference publication. Physical phone behavior remains unverified.                                                                                           |
| F13 delayed attachments          | Real R2 uploads, thumbnails and signed downloads passed with recreated client state and day-six/day-eight retries; test objects were removed. The subsequent G03 production-origin CORS check also passed.                                               |
| F14 document association         | Ten PostgreSQL cases passed, including concurrent upload/edit orderings, explicit links, filters, sync versions, isolation and rollback.                                                                                                                 |
| F04 export/restore               | Eighteen cases passed, including legacy backups and returns after restore; this is a firm-JSON check, not an independent full database/object disaster-recovery drill.                                                                                   |
| F16 availability                 | Bounded local dependency stubs, recovery, repeated socket cleanup and 700 requests per health route passed. Long ordinary queries remained allowed.                                                                                                      |
| Connected Playwright             | Login and one-click takeover passed; the replaced browser showed the correct reason. Dated statement rows, backup notice and GST empty state rendered correctly. Three return saves of Rs 118.67, Rs 118.66 and Rs 118.67 cleared a Rs 356 bill exactly. |
| Small-screen browser             | GST summary at 390px had no horizontal overflow and no page console errors. This does not exercise native SecureStore or phone permissions.                                                                                                              |

The browser export was rebuilt with Metro's cache cleared after a cached bundle
retained an older local API address. No environment file was edited. After the
checks, the generated export was rebuilt using the existing local configuration;
temporary harnesses, the synthetic database container and test servers were removed.

### Apply These Repairs to the Installation

1. Back up the intended database and verify that backup; pause API writes and
   worker cleanup during the upgrade.
2. Run `bun run --cwd apps/api db:migrate` against that intended database. These
   repairs add migrations **0025** (durable retries) and **0026** (return amounts).
   Only the disposable database was migrated during this verification.
3. Update API, worker and clients together. The account statement now includes
   dated opening rows with a nullable voucher, and new return previews use saved
   monetary components. Clear the Expo/Metro cache when changing build API URLs.
4. Preserve unresolved local entries, original request keys and attachment files.
   Existing historical notes are not rewritten; reconcile old overcredits and
   genuinely unknown retry outcomes explicitly.
5. Complete G04/G05's remaining operator and phone/deployed acceptance steps before
   adopting this installation as the primary ledger. G03's saved CORS policy is
   verified; retain it as documented in
   [guide 16](16-document-storage-setup.md#bucket-permissions-and-cors) and keep
   business documents private.

## Confirmed Application Findings

P1 means fix before relying on affected books. P2 means a concrete correctness,
security or reliability issue to resolve before private release. P3 means lower
urgency, but the user-facing behavior should still be corrected. Source line
numbers below refer to this audit's working tree and may move after edits.

### F01 — P1: Some financial retries can create the same entry again after seven days

**Status, 26 October 2026:** implemented and checked locally. Apply migration
`0025_durable_retry_answers` and update API, worker and clients together before
relying on this protection. The business database has not been migrated by these
checks. The subsequent application fixes are recorded under F02-F18 below.

**Where:** [shared idempotency reader and cleanup](../packages/backend/src/modules/vouchers/idempotency.ts),
lines 31-80; [settlement writer](../packages/backend/src/modules/settlements/settlements.shared.ts),
line 77; [legacy sync replay](../apps/api/src/modules/sync/sync.repo.ts), line 108.

The older paths consult only `idempotency_keys`, which the worker deletes after
seven days. The client can retain an uncertain request for longer. Durable
`operation_receipts` exist, but these readers do not consult them; settlement
responses also do not match the existing archive trigger's financial shapes.

**Scenario:** an advance or legacy financial mutation commits, its response is
lost, cleanup runs, and the same key is retried while the period remains open.
The writer can execute again. Simulated replay tests observed two executions for
one original key after removal of the short-lived answer. This is not a claim
that every modern outbox operation fails: the newer operation path retained its
answer and passed the tested lost-response/restart case.

**Repair:** use permanent operation identity and answer lookup on every financial
write path, including online-only settlements and legacy sync. Preserve firm,
user, request-hash and authorization checks. When an old answer cannot be proven,
return an explicit reconciliation state; do not treat it as permission to post.
Increasing the seven-day limit alone leaves the same failure at a later date.

**Acceptance:** commit, discard the response, run cleanup, advance beyond seven
days, restart and retry. The original ID must return and exactly one financial
entry must exist. Cover advances, expenses, ordinary vouchers and legacy clients.

#### Implemented behavior

- Shared writers now read permanent `operation_receipts` before the short-lived
  cache and save both answers inside the business transaction. This covers direct
  financial writes, online settlements and both legacy sync receipt layers.
- Migration 0025 retains every remaining cache answer, including settlement
  records and sync envelopes. It preserves existing permanent receipts. Cleanup
  removes a cache row only if its matching committed permanent answer exists.
- Legacy sync returns the original applied/conflict envelope. If only its inner
  voucher answer survived, it reconstructs the envelope for creates, edits or
  cancellations. A different request using the same key cannot replace the answer.
- New direct requests and attachment IDs use UUIDv7. Previously stored UUIDv4
  keys are preserved. A missing answer for an older key returns
  `RETRY_RESULT_UNKNOWN`, rather than executing an unknowable request again.
  Modern `/operations` outbox keys keep their existing protocol and UUID support.
- Pending requests retain their key after access/session failures, unknown
  outcomes and key collisions. Current membership and voucher permissions still
  apply when returning archived answers. Parameterized order routes also check
  the saved order type.
- New direct attachment drafts record `durable-retries-v1`; they no longer hit
  the old six-day financial retry limit. Historical drafts keep their guard.
  Retained upload answers accept both `{ documentId }` and historical full tickets,
  then renew the signed URL through the existing access checks. This necessarily
  addresses the receipt-format part of F13. The later live R2 recovery checks
  and remaining production-origin setup are recorded under F13 and G03.

#### Checks and rollout

Focused checks used a disposable PostgreSQL 17 database and synthetic firms only.
The 19 regression groups cover migration from 0024 and repeat migration, concurrent
expense requests, advances, eight-day cache expiry, changed payload/firm, separate
users, closed periods, revoked access, legacy sync recovery, rollback, guarded
cleanup, native outbox receipts and client key/draft retention. Document checks
exercise real database reservations with a fake URL signer; no R2 objects or
business records are created. These are domain-service/storage checks, not a full
HTTP, login or physical-device test. No CI or permanent test runner was added.

A separate process then replayed the settlement, expense and sync mutation with
their original answers and unchanged voucher/receipt counts. Workspace typecheck
and lint passed (seven tasks each), as did the API and worker builds and Expo web
export. Temporary test files and the disposable database were removed afterward.

For the existing installation:

1. Take a verified database backup and pause API writes and the worker's cleanup.
2. From the repository root, apply the pending migrations:
   `bun run --cwd apps/api db:migrate`.
3. Start the updated API and worker, then update/reload the web and native clients.
   Do not send new UUIDv7 requests to an older server, or roll the server back
   while keeping the new client active: the ID convention requires durable writes.
4. Keep old pending requests and attachment copies. A retained old answer can be
   replayed. If the answer was already erased before this upgrade, inspect the
   books manually; never clear its key or generate a replacement just to retry.
   Older clients cannot start new direct UUIDv4 writes after this upgrade and
   should be updated. External legacy-sync callers must use UUIDv7 for new work.

### F02 — P1: Automatic allocation can reuse money already refunded

**Implementation, 26 October:** fixed. Allocation checks source capacity and
available funds separately for each book at every affected date. Four PostgreSQL
customer/supplier full/partial-refund cases now keep bill pending equal to the
party balance; 76 focused synthetic cases cover reversals and historical limits.

**Where:** [allocatePartyPayments](../packages/core/src/mock/db.ts), line 710;
called by the live [allocation service](../apps/api/src/modules/masters/allocations.service.ts),
line 30. Despite its `mock` directory, this core writer is used by the backend.

The allocator calculates available funds as receipt/payment amount minus its
allocations. It does not apply the settlement-aware remaining-funds calculation.
A refund has its own journal and does not necessarily lock the original receipt.

**Reproduction:** receive Rs 100 on account, refund Rs 100, then create a Rs 100
sale. Available credit correctly reads zero, but automatic allocation applies
Rs 100 to the sale. The invoice reads paid while the party ledger still shows
Rs 100 due. The synthetic refund used the real journal/settlement line builders
with the metadata supplied by backend hydration; the HTTP transaction was not run.

**Repair:** share the dated, book-scoped funding checks already used by settlement
corrections. Prevent allocation from exceeding the party's genuine available
credit and the source's remaining capacity.

**Acceptance:** customer and supplier cases, partial/full refunds, reversals,
GST/non-GST separation and backdated allocation must keep bill pending amounts
consistent with the party balance and available advances.

### F03 — P1: A full purchase return can leave value in a zero-quantity stock lot

**Implementation, 26 October:** fixed. New purchase returns save the lot's
carrying cost independently of supplier credit. Full depletion removes residual
value; the existing periodic accounts recognize unrecovered freight in profit
and loss. Backdating before later movements in that lot requires reconciliation.
The full-return PostgreSQL reproduction and 16 focused synthetic groups passed.

**Where:** [createNote](../packages/core/src/mock/db.ts), line 1383;
[consumeStock](../packages/core/src/accounting/stockLots.ts), line 59.

Purchase returns copy a proportional original purchase cost. A later landed-cost
adjustment changes the lot's carrying value, but consumption prefers that old
saved line cost even when returning all remaining units.

**Reproduction using core operations:** buy 10 units for Rs 1,000, add Rs 100
freight to the lot, then return all 10. The resulting lot has quantity zero and
value Rs 100. Final accounts retain Rs 100 closing inventory and no corresponding
loss/expense in that example.

**Repair:** distinguish the supplier credit from the stock carrying value removed.
Fully depleted lots must not retain an inventory asset. Explicitly account for
unrecovered freight or other cost differences according to the transaction; do
not silently discard value or over-credit the supplier. Preserve historical
costs on already-issued sales. The inventory-cost basis should include relevant
acquisition costs; see [ICAI AS 2](https://indasaccess.icai.org/Volume-III/AS/asb.html?a=105).

**Acceptance:** full and partial purchase returns before/after landed-cost
adjustments, including lots partly sold. Stock, supplier balance, expense and
final accounts must reconcile at each relevant date.

### F04 — P2: Several partial returns do not sum back to the original invoice

**Implementation, 26 October:** fixed for new returns. Migration
`0026_return_amounts` adds saved line components used by calculations, postings,
reports, print, backup and preview. Goods receive their proportional share of
original rounding; charges and their tax stay on the bill. Notes can contain
paise instead of independently rounding every return to a whole rupee. PostgreSQL
nil/18% three-part returns reconcile exactly; 16 synthetic groups and 250
fractional partitions passed. Existing issued notes are not rewritten; already
overcredited historical notes need review before further returns.

Eighteen additional disposable PostgreSQL export/restore cases passed, including
GST/nil-rate discounted returns, landed costs, a final return after restore and
legacy v2/v3/v4 exports without the new field. The restore reader verifies the
original checksum before adding the nullable field; unknown or malformed fields
are still rejected. Old issued note amounts remain unchanged.

**Where:** [createNote](../packages/core/src/mock/db.ts), lines 1374 and 1397.

Each return independently prorates discounts and recalculates invoice/tax/rupee
rounding. Stock cost already uses cumulative rounding, but money and tax do not.

**Reproduction:** a nil-rated sale of three units at Rs 100.49 totals Rs 301.
Returning one unit three times credits Rs 100 each, leaving Rs 1 receivable after
all goods are returned. At 18% intrastate tax, the tested original totals Rs 356
and the three returns total Rs 357, with a residual two paise in net output tax.
Each individual journal can still balance, so a trial balance alone misses this.

**Repair:** allocate original monetary/tax components cumulatively and apply the
remaining difference on the final return. Make the policy for returning invoice
charges explicit rather than assuming freight is always refunded.

**Acceptance:** split returns equal one full return for taxable value, discounts,
CGST/SGST/IGST, bill rounding and stock, with no unexplained residual.

### F05 — P2: Later receipts can make a backdated return leave a fully returned bill overdue

**Implementation, 26 October:** fixed by checking return-date capacity and every
later settlement date. Conflicting backdated returns are rejected with a request
to reconcile the later entries; they do not silently rewrite receipt allocations.
PostgreSQL rejection, receipt cancellation and successful corrected return passed,
along with 51 synthetic groups across both party types and books.

**Where:** [createNote](../packages/core/src/mock/db.ts), line 1401.

Return allocation uses `settledAmounts(db.vouchers)` without the return date.
An allocation from a later receipt can consume the bill's capacity before that
receipt exists in the requested historical view.

**Reproduction:** sale Rs 100 on April 1; allocated receipt on April 10; full
return entered on April 5. The return receives no bill allocation. Cancel the
incorrect receipt using `cancelVoucher`: the party balance is zero, but the bill
has Rs 100 pending and an overdue status. All four operations were accepted by
the core; no voucher or allocation state was manually edited.

**Repair:** make return/receipt allocation chronological and define how later
allocations are reconciled or rejected. Cancellation must not leave a fully
returned invoice with an unexplained payable/receivable. Simply filtering dates
without checking future allocations could introduce double allocation.

**Acceptance:** compare bill pending, party statement and collection view before
and after the later receipt, its cancellation and a partial return.

### F06 — P2: A later interest-payment reversal can authorize an earlier overpayment

**Implementation, 26 October:** fixed. Payment capacity observes effective
reversal dates and later dependent events; replacement accruals cannot overlap.
Posting still requires review and explicit duplicate confirmation. The real
PostgreSQL May 15 rejection / June 1 repayment flow and 72 synthetic cases passed.

**Where:** [interest service](../apps/api/src/modules/settlements/interest.service.ts),
lines 74 and 135.

The eligibility calculation excludes every reversed settlement regardless of
when its reversal took effect.

**Scenario reproduced in the dated eligibility/journal calculation:** accrue
Rs 1,000 on April 30, pay on May 1, reverse the payment on May 31, then enter
another payment dated May 15. The May 1 payment is treated as already reversed,
allowing a second payment before the reversal date and a negative payable during
the intervening period. A live database transaction remains to be checked.

**Repair:** determine accrued, paid and reversed amounts as of the requested date,
then validate later dependent events as well. Continue requiring explicit review
before posting interest, as already agreed for this product.

**Acceptance:** reject an overpayment before the reversal becomes effective;
allow a valid repayment afterwards. Test partial payment/reversal sequences.

### F07 — P2: Account statements apply a party opening balance before its effective date

**Implementation, 26 October:** fixed. Dated opening movements and their capital
counterparts now appear in the timeline and exports, before same-day vouchers.
Opening rows have `voucher: null` and cannot open an editable voucher. Update the
client with the API for this response change. The PostgreSQL October example,
612 dated reconciliation cases and 408 export cases passed across book views.

**Where:** [accountStatement](../packages/core/src/accounting/generalLedger.ts),
line 401; exposed by [accounts service](../apps/api/src/modules/accounts/accounts.service.ts),
line 63.

The statement starts with all opening postings, without their effective dates,
then replays vouchers. Other balance readers already respect `openingDate`.

**Reproduction:** party opening Rs 1,000 dated October 25 and a Rs 100 sale dated
October 1. The October 1 statement row shows Rs 1,100; the account's balance as
of October 1 is correctly Rs 100.

**Repair:** include dated opening movements in the statement timeline, including
their capital counterpart where relevant. Keep opening, period movement and
closing definitions consistent across screens and exported ledgers.

**Acceptance:** statements and dated trial balances agree before, on and after
the opening date in all three book views.

### F08 — P2: Notification scans omit imported opening bills and can send the wrong due signal

**Implementation, 26 October:** fixed using the shared imported-opening reader,
including GST opening shares. The PostgreSQL paid-old-bill / later-due-bill case
now produces no false reminder; 14 synthetic scenarios passed. No reminder was
sent to an actual customer during verification.

**Where:** [notification snapshot](../packages/backend/src/modules/notifications/notifications.repo.ts),
line 78. Normal report loading already includes imported opening bills.

**Reproduction:** opening balance Rs 1,000 comprises an old Rs 600 bill and a
Rs 400 bill due October 30. Pay the old bill on October 15. On October 25 the
correct reminder list is empty. The notification snapshot's missing bill detail
instead produces Rs 400 overdue by 24 days using the aggregate opening date.

**Repair:** hydrate the same imported opening bills used by reports. Reuse that
reader for notice lists and scheduled reminder preparation, so due dates and
allocation identities agree.

**Acceptance:** partial/full payments of imported bills, different due dates and
reminder repetition must agree with the party page. Never remind solely because
an older, already-paid imported bill existed.

### F09 — P2: An expected import-protection conflict becomes a generic server error

**Implementation, 26 October:** fixed. Known `P0021` errors become
`409 / IMPORTED_OPENING_IMMUTABLE`, including sync conflicts. Unknown errors stay
private. Actual PostgreSQL guard-to-HTTP verification and 14 synthetic groups
passed. Reopening balances does not unlock immutable imported openings.

**Where:** [bookControlError](../apps/api/src/lib/book-errors.ts), line 11;
database migration `0021` raises `P0021` for protected financial imports.

The error mapper recognizes `P0010` only. An in-process HTTP check with a wrapped
`P0021` database error returned HTTP 500 / `SERVER_ERROR`, rather than an
actionable conflict. The database protection itself still prevents the edit.

**Repair:** map this known guard to a stable 409 response and explain the allowed
correction procedure. Apply the same mapping to sync. Keep unknown database
errors private rather than returning raw SQL details.

**Acceptance:** ordinary HTTP and sync attempts to edit a protected imported
opening return the same understandable conflict without changing records.

### F10 — P2: Native secure-storage failures can bypass the PIN or leave credentials after logout

**Implementation, 26 October:** fixed. Missing, malformed and unavailable secure
storage are distinct states. PIN/biometric checks fail closed; background and
startup checks retain the lock on failure. Logout persists a blocking marker and
clears credentials before removing the PIN, and exposes a retry when storage
fails. Pending entries and attachment copies are preserved. Twenty-eight native
fault groups, including four process restarts, and two web regression groups
passed. Actual phone SecureStore/biometric behavior still needs device acceptance.

**Where:** [native secret storage](../apps/native/src/auth/storage.ts), lines 9
and 21; [checkPin](../apps/native/src/auth/pin.ts), line 67;
[finishLogout](../apps/native/src/auth/AuthProvider.tsx), line 94.

Read failures become `null`, and a missing saved PIN is accepted. A simulated
storage read failure therefore accepted a PIN without validating the stored
hash. Delete failures are also swallowed: if server logout is unavailable and
credential deletion fails while PIN deletion succeeds, the view reports logout
but a later launch can retain credentials without the former PIN protection.

**Repair:** distinguish missing data from unavailable storage. Fail closed when
reading a configured lock. Confirm durable credential removal before removing
the lock, and expose a recoverable logout failure. Do not solve this by deleting
pending financial entries or attachment copies.

**Acceptance:** inject read/delete failures, restart the native app and verify
that neither unlock nor completed logout is falsely reported. Repeat on a real
phone; browser tests cannot exercise SecureStore.

### F11 — P2: Two overlapping device takeovers can revoke both new sessions

**Implementation, 26 October:** fixed with a per-user/platform transaction lock,
a check that the candidate session still exists, and atomic revocation markers.
A loser receives `409 SESSION_REPLACED`. PostgreSQL and actual Better Auth login,
explicit takeover and five simultaneous takeovers passed: exactly one web
session survived and the phone session remained usable. Eight focused groups
also covered 100 simulated races and rollback.

**Where:** [endOtherSessions](../apps/api/src/auth/sessionRules.ts), lines 53-79;
called from the session-create hook in [auth configuration](../apps/api/src/auth/auth.ts).

Both hooks can list the newly created sessions A and B. A deletes B and B
deletes A because each removes every other session on its platform. An
in-memory interleaving of the real helper left zero surviving sessions; the
single-transfer baseline correctly left one.

**Repair:** make creation and replacement choose one winner atomically per user
and platform. Serializing only part of the after-hook is insufficient if both
sessions can already be visible. Preserve the intended separate app/web slots.

**Acceptance:** simultaneous confirmed logins from two same-platform clients
leave exactly one valid session. The loser receives a clear replacement result,
not an endless login/takeover loop. Verify against PostgreSQL as well.

### F12 — P2: OTP resend paths bypass the application's per-email quota

**Implementation, 26 October:** fixed. All five enabled sending paths use the
same normalized-email quota, including resend and password-reset aliases.
128 in-process requests / 249 assertions covered quotas, aliases and login
separation without sending email. The password-login limit remains ten/minute.

**Where:** [auth route limiter dispatch](../apps/api/src/plugins/auth.ts), line 24;
the frontend uses `/email-otp/send-verification-otp` for resend.

`EMAIL_CODE_SEND_PATHS` includes signup and one reset endpoint, but omits resend
and an alternative reset path. With the per-email quota stubbed as exhausted,
signup/reset were blocked with 429 while `/email-otp/send-verification-otp` and
`/forget-password/email-otp` reached the auth handler. This tests the wrapper;
Better Auth and the general IP limit still impose their own restrictions.

**Repair:** apply one normalized per-email sending policy to all supported code
delivery paths/aliases. Keep the existing ten-per-minute password-login policy
separate from email sending and OTP verification.

**Acceptance:** exhausting the email quota blocks every delivery alias, while
valid password retries and an ordinary successful device transfer remain usable.

### F13 — P2: Delayed attachment recovery expects a different reservation receipt shape

**Implementation and verification, 26 October:** fixed by F01's migration 0025
and shared reservation reader; no second recovery implementation was needed.
The real client recovery functions, disposable PostgreSQL and configured R2
passed lost-response recovery on days six/eight, expired URL renewal, compact
and legacy full-ticket answers, repeated/concurrent confirmation and access
rejection. Each completed case kept one reservation and one completed document;
downloaded full-image and thumbnail bytes matched the image processor's output.
The harness recreated local state with simulated storage; it was not a physical
phone restart. Test objects were deleted and their absence checked. Production
browser CORS subsequently passed the G03 checks after the owner updated it.

**Where:** [reservation lookup](../apps/api/src/modules/operations/operations.documents.ts),
line 32; [upload reservation writer](../apps/api/src/modules/documents/documents.service.ts),
line 232; [archive migration](../apps/api/src/db/migrations/0022_operation_receipts.sql),
line 22.

The current reservation writer saves `{ documentId }`. The recovery lookup
instead parses a full `{ document, uploadUrl, expiresAt }` ticket. The archive
trigger also recognizes the older full-ticket shape, not the compact answer.

**Scenario:** the initial reservation response is lost and the client resumes
after its six-day safety threshold. Lookup fails to parse the still-retained
compact answer. After cleanup it can become unknown. The local file is retained,
but the intended automatic reconciliation cannot finish.

**Repair:** retain the durable reservation identity, accept both historical
answer formats and renew authorization/URLs separately. Never preserve expired
signed URLs as a substitute for identity, or silently allocate a duplicate key.

**Acceptance:** lost response, restart and recovery on days six/eight return the
original document ID and finish exactly one upload. Cover legacy receipts too.

### F14 — P2: Editing an invoice's party leaves the attachment under the old party

**Implementation, 26 October:** fixed. Allowed voucher edits update inherited
document party links in the same transaction, with sync/version changes.
Explicit links, independent library documents and journal associations are
preserved. The document lock serializes edits with upload reservations; pending
reservation age is not extended. Ten disposable PostgreSQL cases passed,
including both concurrent upload/edit orderings, filters, isolation and rollback.

**Where:** [document linking](../apps/api/src/modules/documents/documents.service.ts),
line 85; [document filtering](../apps/api/src/modules/documents/documents.repo.ts),
lines 88-106; [voucher persistence](../packages/backend/src/modules/vouchers/persist.ts),
line 182.

The attachment copies the voucher's party when it is reserved. An allowed edit
to an unsettled invoice updates its party/postings but not that copied link.
Document lists join the stored old party, while filters also match new postings.

**Scenario from source tracing:** attach a sale for party A, then change that
sale to B. The document can display A and appear under both party filters. This
is a same-firm association error, not evidence of cross-firm data disclosure.

**Repair:** derive inherited party association from the current voucher or update
it transactionally on edits. Preserve deliberately assigned library-document
links and the original issued-document history where appropriate.

**Acceptance:** after an allowed party edit, voucher attachments and filters
agree; independent library documents retain their explicit association.

### F15 — P2: Native saved report filters return success before file publication completes

**Implementation, 26 October:** fixed. Both recovery and publication moves are
awaited inside the existing lock, and failures reach the caller. Ten mocked
checks with 134 assertions covered delayed moves, failures, recovery and 50
concurrent saves. A physical native restart remains a device acceptance check.

**Where:** [report preference storage](../apps/native/src/data/reportPreferencesStorage.ts),
lines 39-42.

Both `File.move` calls are unawaited. The installed Expo FileSystem 57.0.7
declarations define `move` as returning a Promise. The preference lock can be
released and the UI can acknowledge saving before publication finishes.
A delayed-move simulation lost the first of two overlapping preference updates.

**Repair:** await recovery/publication moves inside the existing lock and propagate
failure to the caller. Keep the simple storage design; a new service is unnecessary.

**Acceptance:** rapid saves preserve both changes, simulated move failure is
visible, and preferences survive a real native restart.

### F16 — P2: Health checks can hang or be rejected by normal request limits

**Implementation, 26 October:** fixed. Readiness shares a three-second deadline
and dedicated one-second database/Redis probe limits. Normal financial queries
and BullMQ connections retain their existing settings. Both routes bypass
application quotas. Healthy, failed, stalled and recovered local protocol stubs
passed, including 700 requests to each route, concurrent probes and repeated
PostgreSQL timeout/socket cleanup. A normal 3.2-second query still succeeded.
These checks do not establish deployed worker health or successful queue jobs.

**Where:** [system routes](../apps/api/src/modules/system/system.routes.ts),
line 21; [database readiness call](../apps/api/src/server.ts), line 53;
[global rate limiter](../apps/api/src/plugins/rate-limit.ts), line 83.

Readiness awaits each dependency without a deadline. A deliberately stalled
check remained unanswered after 5.2 seconds and only completed when released;
the source supplies no upper bound. Separately, an in-process sequence returned
200 for the first `/health` request and 429 for request 301 in one minute.

**Repair:** set connection/query limits and an overall readiness deadline. Return
503 promptly when dependencies are unavailable. Exempt `/health` and `/ready`
from normal application quotas and keep responses free of credentials.

**Acceptance:** stalled PostgreSQL/Redis cannot hang a probe indefinitely; normal
traffic does not consume probe quota. Worker health and successful job execution
must still be checked separately.

### F17 — P3: The backup notice claims knowledge the system does not have

**Implementation, 26 October:** fixed. The notice says backup status is
unverified and links to manual export/recovery. A known export preparation time
is explicitly not proof of a saved or tested backup; missing preparation time
is described as unknown. Four timestamp scenarios passed focused checks.

**Where:** [notice builder](../packages/core/src/accounting/notifications.ts),
lines 166-175; [notification service](../apps/api/src/modules/notifications/notifications.service.ts)
does not supply `lastBackupAt`.

The resulting notice says “Your books have never been backed up” even though the
application cannot see a manually saved export or provider backup. The default
notice was reproduced with the actual builder.

**Repair:** say that backup status is unverified and show the manual recovery
action. If tracking export preparation, label that separately from a saved,
independent and successfully restored backup. Do not mark a full backup complete
merely because JSON was generated.

**Acceptance:** unknown backup status is described honestly; no false success or
false “never” assertion appears after an export.

### F18 — P3: An empty book summary gives an unjustified GST filing instruction

**Implementation, 26 October:** fixed. Empty results describe the selected
month and Regular GST sales filter. The screen and shared text explain that
this is a book summary, including its excluded sale modes. The nil-filing advice
and obsolete portal-JSON promise were removed.

**Where:** [GSTR-1 empty state](../apps/native/app/gstr1.tsx), line 79.

The page tells the user to file a nil GSTR-1 solely because the selected local
summary has no sales. Playwright reproduced this message for an empty month.
That condition does not establish filing obligations or completeness of the
business's records, and exceeds this product's agreed normal-reporting scope.

**Repair:** say that no matching sales are recorded for the selected period and
that this is a book summary. Remove the obsolete comment promising future portal
JSON unless that becomes an explicit product decision. No new filing integration
is needed.

**Acceptance:** empty GST/non-GST summaries explain their filters and data state
without claiming a return is due, filed, payable or eligible for credit.

## Private-Release and Environment Gaps

These are separate from the application defects above. Some are newly required
by the private-use decision; others are setup or evidence gaps.

### G01 — Registration and Firm Isolation

**Status, 26 October: passed 85 checks using the real API handlers and disposable
PostgreSQL.** Normal signup, unverified-email rejection, verification, both
password-recovery aliases, session revocation, takeover and separate phone/browser
sessions passed. Independent firms, forged firm headers, cross-firm record IDs,
invitation recipients and owner/accountant/sales/viewer permissions passed.
Better Auth remained 1.7.7. No allowlist or new registration policy was added.
Email was captured locally; actual mailbox delivery remains a deployment check.

**Revised requirement, 26 October:** the user clarified that the current small
installation must continue to support other users and businesses. An owner email
allowlist is not required and must not be introduced. Normal registration,
verified-email login, password recovery, invitations and device replacement stay
available under the existing rules.

The acceptance check is two independent accounts and firms: each can access its
own books, while foreign firm headers and record IDs cannot read or mutate the
other firm's data. Roles must still restrict accounting and owner-only actions
within a firm. “Owner” here is a firm role, not a globally approved individual.
Keep existing authentication and per-request authorization; see
[OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

### G02 — Resolve dependency advisories with application-specific triage

**Status, 26 October: compatible dependency repairs and exposure review completed
locally.** Next.js is 16.4.1, Fastify 5.12.7, Zod 4.6.7, DOMPurify 3.4.17 and both
fast-uri major lines have compatible patches. The Expo dependency's decoder has
a tested CommonJS security backport, installed reproducibly through Bun's patch
mechanism; no forced Expo/React Native upgrade was introduced. All 158 focused
decoder/query checks passed. See [guide 28](28-dependency-review.md) for versions,
sources, patch/lock fingerprints and the exact remaining exposure.

The unsuppressed audit fell from 31 matches (four critical) to eight (zero critical,
three high, four moderate, one low). These eight include the locally patched
decoder, two Swagger dependency advisories with production routes disabled and
five tooling advisories. They remain visible; this is not a zero-vulnerability
claim. Artifact and deployed boundaries must retain the documented protections.

The original `bun audit` returned 31 matches. This is a maintenance/release
gate, not proof that every reported vulnerability is reachable. No exploit or
resource-exhaustion attack was run.

| Package in the lockfile                     | Audit relevance and next action                                                                                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 16.3.3                              | Several server/image/cache advisories. Upgrade to reviewed patched versions and recheck the lockfile before hosting the website. `/icon` uses static `ImageResponse` content, without the attacker-controlled SVG input required by the reviewed next/og advisory |
| Sharp 0.35.5                                | Already satisfies the reviewed image-optimization advisory's documented workaround; do not report that particular RCE as proven merely because Next matches its version range                                                                                     |
| DOMPurify 3.4.16 via jsPDF                  | Advisory includes particular template/DOM modes. Current PDF code uses html2canvas plus `addImage`, not `jsPDF.html`; no exploit path demonstrated. Update compatible dependencies and recheck PDF rendering                                                      |
| Zod 4.6.5 plus older transitive versions    | Validation memory-exhaustion advisory. Update compatible validators/transitives and retain request-size and collection limits; full reachability not established here                                                                                             |
| `@fastify/static` 9.3.0                     | Guard/path advisories via Swagger UI. Swagger registration is disabled when `NODE_ENV=production`; fix the dependency and ensure dev mode/docs are not exposed                                                                                                    |
| Fastify, fast-uri, decode-uri-component     | Runtime/header/URI and malformed-decoding advisories need compatible updates and route/login regression checks                                                                                                                                                    |
| esbuild, node-forge and old transitive uuid | Includes development/build-tool issues; separate those from runtime exposure and avoid running dev servers publicly                                                                                                                                               |

The Next.js conclusions above use the maintainer's
[next/og advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
and [image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
The DOMPurify conditions come from its
[maintainer advisory](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7).
Re-run the audit when updating: these are dated observations, not permanent safe
version recommendations. Avoid a blind cross-major upgrade or forced overrides
of Expo/React Native dependencies.

### G03 — Add the production app origin to private R2 CORS

**Status, 26 October: CORS configuration verified after the owner's update.**
The earlier production-origin 403 is resolved. All twelve PUT/GET/HEAD preflights
returned 204 with the expected origin/method/header permissions across
`https://app.hisaab.sajaldbansal.com`, `http://localhost:8081`,
`http://localhost:19006` and `http://192.168.0.205:8081`. An unapproved origin
returned 403 without an allow-origin header.

An isolated Playwright page using the production origin performed a real signed
PUT (200). The application's storage/image-processing functions created the
readable JPEG and thumbnail; browser signed GETs and HEAD returned 200 with
readable ETag/Content-Length headers. Both downloaded files matched the expected
processed bytes by SHA-256 and size. Staging, full-image and thumbnail test objects
were deleted, and signed HEAD checks confirmed all three were absent (404).

The page itself was fulfilled locally by Playwright, so this verifies real browser
CORS enforcement against R2, not a deployed application's routing, authentication,
metadata confirmation or phone sharing. No business database, environment file or
bucket setting was changed by these checks. Keep business documents private;
CORS is not an authorization boundary and bucket public-access settings were not
inspected with the object-only credential. Retain the policy in
[storage setup](16-document-storage-setup.md) and include the full deployed upload
and sharing workflow in G04's acceptance checks.

### G04 — Local runtime verified; deployment remains

**Implementation, 26 October:** four production Dockerfiles, Compose, Caddy,
Expo SPA Nginx configuration and one type/build/publish/deploy workflow are now
supplied. Images use Linux dependencies, explicit public frontend URLs and private
runtime env files. API and worker remain separate. The initial managed-database
target was superseded by the same-host update below.
No root scripts, permanent test harness or regression-test pipeline was added.

**Layout update, 26 October:** deployment files now live in
[`deployment/`](../deployment/README.md), with separate `compose.dev.yml`,
`compose.local.yml` and `compose.prod.yml`. The dev file supplies only
PostgreSQL/Redis for host-run apps; local builds the application containers;
production pulls published images (its later database layout is described below). The workflow and
guides use the new paths. Root `.dockerignore` and `.github/workflows` retain
their tool-required locations. This supersedes the earlier single-file layout.

Layout verification passed for all three Compose files and the optional local/dev
combination: service separation, build paths, loopback bindings and production-only
proxy exposure. The moved API/worker Dockerfiles passed Docker's build checks;
their unchanged, previously verified images passed local startup, migration and
HTTP signup/login checks. Fresh Expo web/website images built with localhost URLs
and passed routing/link checks; real env files stayed out of the image. PostgreSQL
and Redis retained synthetic records after container recreation, and the worker
rendered an in-memory PDF with the relocated sandbox policy. Workflow YAML,
shell/PowerShell command blocks and documentation links passed checks. No new
application source change or cloud deployment was needed for this reorganization.

**Same-host database update, 26 October:** production now includes PostgreSQL 17
and Redis 7.4 on EC2. This supersedes the earlier managed-service target. They
use authenticated connections, an internal network without host ports, and
separate persistent volumes. Compose derives both app connection URLs from the
two passwords in the private server `.env`. Normal releases preserve those
passwords and database containers, take a pre-migration dump, then replace only
the apps and proxy. Scheduled snapshots and independent backup copies still
require the operator setup in guide 26.

The revised Compose configuration passed a disposable seven-container run using
the existing production application images. The proxy used a loopback HTTP
address and synthetic provider settings; no real email or R2 operation was
performed. All services became healthy, website/Expo/API routes returned 200,
and the real worker completed a cleanup job. Both databases rejected invalid or
missing passwords, and retained synthetic data after container recreation.
PostgreSQL applied and reran all 27 migrations. A custom dump restored into a
fresh, separate volume with the migration journal and synthetic marker intact.
Application rollout preserved the database container identities.

This run found and fixed a proxy IP collision: automatic network allocations
now use `172.30.0.128/25`, leaving Caddy's fixed `172.30.0.2` outside that range.
Eight isolated workflow simulations verified successful deployment and failures
at configuration, database startup, dump, archive inspection, migration, app
startup and public readiness. Failures after the write pause retained the marker
and stopped API/worker; release changes preserved both database passwords.
These checks do not establish EC2 capacity, public HTTPS, scheduled snapshots or
remote backup retention. No application code or Dockerfile rebuild was needed.
Both disposable test stacks, their data volumes and temporary credentials/dumps
were removed after verification; no test server remains running.

Connected checks from the preceding image work found and repaired additional runtime issues:

- The separate readiness Redis connection could report ready while the API's
  lazy limiter/cache connection was unopened, making the first login return 500.
  API startup now opens that connection and readiness checks its state too.
- Worker probes now use dedicated bounded PostgreSQL and Redis connections;
  long-running job queries and BullMQ blocking connections keep their own limits.
- PDF storage's request timeout previously only warned. It now aborts stalled
  requests; an actual stalled endpoint exhausted three bounded attempts in 90 s.
- Docker's default syscall policy prevented Chromium's sandbox from starting.
  The supplied, attributed Playwright profile enables its namespace operations
  while retaining the sandbox and nonroot worker. No privileged mode, unconfined
  profile, extra `SYS_ADMIN` capability or `--no-sandbox` workaround is used.
- Browser checks found no explicit cache policy on account/firm-list and document
  search responses. The cache helper now defaults non-ETag responses to
  `private, no-store`, including errors. Existing authorized firm reads keep
  private revalidation, scoped ETags and explicit no-store exceptions.

The production API image migrated an empty PostgreSQL 17 database and reran
migrations safely; 27 migration entries were retained. Real queued A4/80 mm PDFs
rendered with the sandbox, stored privately in R2 and downloaded correctly.
Classic, compact and modern one-page invoices had readable text, correct dimensions
and visually checked totals. Reminder preparation retained `delivered: 0` and did not mark a customer
reminded. The real cleanup queue kept durable answers and retained old cache rows
without a committed receipt. The sample sale/receipt reports showed 25,600 paise
outstanding and stock value 63,000 paise.

Workflow validation covered actionlint, 14 Bash syntax checks and 11 simulated
rollout cases. These are local checks, not an executed GitHub/SSH deployment.

**Final local container checks, 26 October:** all four Linux images built from
the frozen lockfile, including the decoder patch. API, worker, website, signed-in
app and Caddy reached healthy. The API and worker ran as the nonroot `node` user;
build contexts excluded local env files and temporary credentials. Caddy routed
the three local HTTP sites successfully. This does not verify public DNS, HTTPS
issuance or EC2 networking.

Replacing the API/worker containers preserved the existing session, invoice,
outstanding balance, stock, trial balance and final accounts byte-for-byte at
the JSON-value level. On the final API image, the first application request after
cold startup was a successful login. Live account, firm-list and document-search
responses returned `private, no-store`; focused checks retained firm ETags/304s
and existing no-store exceptions. API typecheck/lint passed after this final
cache change. Production development-documentation endpoints returned 404. Pausing disposable
PostgreSQL and Redis separately produced bounded 503 responses from both API and
worker twice per dependency, while API liveness remained 200. Both recovered to
200 after each service resumed. PDF, reminder-preparation and cleanup queues
also passed on the final worker image.

Playwright checked the production-exported app against the real API: login and
signup navigation, dashboard, reports, an entry deep link, reload and cookie
persistence passed. The browser fixture reconciled a ₹356 sale, ₹100 received,
₹256 due, nine units/₹630 stock and a trial balance of ₹11,196 on each side.
Secure cookie attributes, immutable JavaScript and missing-asset 404s passed.
All twelve website pages, search, report toggles, mobile navigation and four
390-pixel layout checks passed, with no captured page exceptions, unexpected API
failures or email-flow calls. Production HTTPS origins were routed to local
containers for these checks; public DNS/TLS and installed APK behavior were not
tested. This was focused acceptance, not every possible financial workflow.

All three synthetic PDF objects were deleted and their absence verified by 404
HEAD responses. The browser, seven temporary containers, scratch databases,
isolated network and temporary files/credentials were removed; test ports were
closed. Local images remain available for inspection. No business database,
existing environment file, public deployment or GitHub commit was changed.

For deployment, configure the separate worker's own environment and verify its
sandboxed browser on the intended host. Configure API and worker with the same
intended database, Redis and private storage, while exposing only the API through
HTTPS. Start both services and verify health and a real queue job.

For a small private release, keep API, worker and the signed-in web app plus an
HTTPS proxy. Include the marketing website only if you want it. The current
budget deployment runs PostgreSQL/Redis on EC2 with persistent volumes,
process restart policies, bounded log
storage and one simple deployment workflow. Guides 25-26 explain the supplied
files and remaining operator setup. A restart policy reacts to process exits
or Docker restart; it is not proof that an unhealthy, still-running process will
be repaired. See [Docker restart policy documentation](https://docs.docker.com/engine/containers/start-containers-automatically/).

Build the Expo client with explicit production API URLs and login enabled. A
browser export is not a phone build. Keep signing credentials and the application
ID stable, verify an installed APK upgrade, and keep a usable copy of the prior
release. Public APK hosting and app-store submission can wait for private use.

### G05 — Demonstrate recovery before making this the primary ledger

**Status, 26 October: isolated recovery rehearsal passed; provider/operator setup
remains required.** A real PostgreSQL 17 custom dump restored all 27 migrations
into a separate database. Two restored accounts could log in; foreign-firm access
returned 403. Financial totals matched and retrying the original request key
created no duplicate. Synthetic R2 original/thumbnail objects were independently
copied, deleted and restored with identical SHA-256 hashes. Invalid identity
tickets were rejected; six concurrent redemptions yielded one credential and no
normal session. Test objects, databases and harnesses were removed.

Financial JSON exports restore a new firm and include attachment metadata, not
the image/PDF bytes or a full authentication database. Full database and object
backups, retention and independent copies are operator responsibilities. Guide 20
now supplies the manual identity-verification, ticket-issuance and controlled
reconnection procedure; it does not expose a public recovery-ticket issuer.

For a small installation, a documented manual procedure and provider backups are
sufficient to start if you actually test them. You do not need a new backup framework or
root scripts. Restore PostgreSQL and documents into isolated targets, verify
access, totals and files, then explicitly reconcile uncertain client writes
before reconnecting. Never use production books as the restore experiment.
See [firm export/recovery](19-backup-recovery.md) and
[manual recovery responsibilities](20-manual-recovery.md).

Still record provider/PITR recovery, retention, independent encrypted copies and
key custody, recovery time/data-loss targets, real mailbox recovery and intended
device reconnection. The synthetic rehearsal does not establish those services.

## Ordered Work Plan

Each step has a finish condition. Keep changes small and use the existing core,
contracts, backend services and frontend hooks. Regression checks can be focused
local checks; this plan does not require a large CI test framework or scripts.

| Order | Work                                                                         | Finish condition                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Establish a safe baseline                                                    | Bring up intended development PostgreSQL/Redis; identify applied migrations; preserve current books and use disposable sample books for destructive/fault checks. Keep access local until step 5 is complete |
| 2     | Fix durable financial and reservation recovery: F01, F13                     | Lost responses and retries beyond cleanup return original identities without duplicate postings/uploads                                                                                                      |
| 3     | Fix allocations, inventory costs and returns: F02-F05                        | Refunded funds cannot pay a new bill; fully returned goods leave no unexplained asset or party/tax residual; cancellation keeps bill status consistent                                                       |
| 4     | Fix dated history and imported openings: F06-F09                             | Dated interest, account statements, opening-bill reminders and conflict responses pass their listed examples                                                                                                 |
| 5     | Verify registration, firm isolation and authentication: G01, F10-F12         | Independent users stay within their authorized firms; one takeover survives; secure-storage failures cannot silently unlock or complete logout; email-code routes share quotas.                              |
| 6     | Finish document association and native preference reliability: F14, F15, G03 | Edited entries have correct document filters, native saves survive restart, and production-origin R2 upload/view/download works                                                                              |
| 7     | Correct misleading status text: F17, F18                                     | Backup state and GST summaries describe only what the system actually knows                                                                                                                                  |
| 8     | Update dependencies and operational readiness: G02, F16, G04                 | Advisory triage recorded, targeted upgrades checked, bounded readiness, separate configured worker and real PDF/reminder preparation verified                                                                |
| 9     | Implement the minimal deployment from guides 25-26                           | Production containers run locally and on EC2, migrations stop rollout on failure, HTTPS/proxy/cookies work, restart works, and rollback retains env/data                                                     |
| 10    | Run the connected acceptance and recovery checks below: G05                  | Financial totals reconcile after restart, offline retries and restore; record the exact release and any explicitly accepted limits before using it as primary books                                          |

**Current progress: F01-F18 and the local G-phase implementation are complete.**
Apply migrations 0025/0026 to the intended database and update clients with the
API/worker. G01 passed, G02 repairs/exposure triage are recorded and G03 CORS is
verified. Finish G04's actual deployment and G05's retained provider/independent
backup setup, then complete device and deployed acceptance. Local synthetic
checks do not replace those operator steps.

### Final connected acceptance sequence

1. Log in as an account with the firm's owner role on browser and phone. Repeat the allowed
   device transfer once and concurrently; test wrong credentials, OTP resend and
   password recovery without sending unsolicited reminders to customers.
2. Create sample firms for the relevant registration modes. Set up customers,
   suppliers, cash/bank, capital and loan ledgers. Approve reviewed opening
   balances and confirm subsequent opening edits are protected.
3. Purchase the same item in GST/non-GST lots at different costs. Add landed
   cost, sell selected lots and confirm mixed stock creates separate bills and
   number series. Compare units, cost, discount, freight and tax calculations.
4. Receive and allocate payment, post an advance, refund it, process partial and
   full returns, then edit/cancel allowed entries. Check every F02-F09 example in
   actual backend transactions, not just the in-memory engine.
5. Post a reviewed loan interest accrual/payment/reversal and a sale commission
   with a return and payout. Commission must use discounted value excluding GST
   and freight; principal, interest and capital must remain distinct.
6. Compare party ledgers, bill pending, day book, trial balance, P&L, balance sheet,
   stock and report downloads. Mixed figures should equal GST plus non-GST where
   the report definition is additive. An arithmetically balanced trial balance is
   not sufficient evidence of correct classifications or dated allocations.
7. Attach multiple phone photos and a supported document. Check compression,
   readable originals, stored small thumbnails, folders/party/ledger/date filters,
   edited-party association, signed expiry, download and share. Check transfer
   interruption and low-storage failure without deleting pending copies.
8. Download authorized books, disconnect an already-loaded browser, queue a
   supported entry, close/reopen the native app, reconnect, and lose a response
   after server commit. Verify exactly one entry after repeated retries. Include
   day-eight retry, two browser tabs, a version conflict, lock/logout and expired
   offline authorization. Keep online-only operations explicitly unavailable.
9. Restart API, worker, client and the host. Recheck balances, attachments, queue
   progress, login and readiness. Confirm the worker creates a private PDF and
   prepares reminders; preparation is not proof a WhatsApp message was delivered.
10. Export a firm and restore it as a new sample firm. Separately restore a full
    database and its object copies into isolated infrastructure, recover owner
    access and reconcile pending client operations. Record the latest recovered
    entry, missing files, recovery duration and acceptable data-loss window.

Do not require offline browser cold starts for this release unless you choose to
add that feature. The current app has no complete offline shell/service-worker
installation; reload/cold start needs network. Existing loaded-page caching and
queued operations have the limits documented in [offline books](17-offline-books.md).

## Business, Human and Performance Review

For private use, the main human risk is acting on a misleading financial state:
chasing a paid customer, allocating refunded money, trusting a stale report,
assuming a file is backed up, or believing an uncertain save failed. The findings
above connect those situations to concrete code paths. Keep pending, posted,
rejected and unknown states visibly distinct and provide one recovery action.

Before adopting the books, agree the firm's opening balances, inventory cost
basis, treatment of unrecovered freight, return adjustments and loan interest
with the person responsible for those accounts. GST/non-GST is the chosen book
classification; the application should not imply that selecting a category
determines a transaction's tax treatment or completes filing.

Customer names, phone numbers and bill photos remain private business data even
with one operator. Check the recipient and amount before sharing a reminder or
document. Keep document buckets and backups private, limit infrastructure keys,
retain access to recovery email/signing credentials, and avoid clearing browser
or phone storage while saves are unresolved. These are operating requirements,
not requests to add public-SaaS consent, marketing or billing systems.

Existing caches and the separate worker should be retained. The Expo export's
main web bundle is about 2.8 MB before transport compression; this is a measurement,
not evidence that a redesign is necessary. Measure cold load, report latency and
memory on the intended device and realistic annual data before adding caches or
splitting more services. Check HTTP compression/static asset caching, report query
costs, pagination, thumbnail requests and bounded export sizes first. Never cache
financial answers across firms or let stale UI data authorize a write.

A broader multi-user launch, advanced tax integrations, cost centres, multiple
warehouses, subscription billing, additional languages and automatic loan posting
are outside this private release. No missing page among those optional areas
should delay the correctness and recovery work above.

## Release Record To Fill In After Repairs

- [x] F01-F18 resolved and locally checked; deployment still requires migrations and coordinated client updates.
- [x] Registration, account recovery, firm isolation and per-firm roles checked with separate accounts; no global owner allowlist.
- [x] Dependency advisories updated/triaged with production exposure recorded in guide 28; eight registry matches remain visible.
- [ ] Real database, Redis, worker, email and R2 checks completed.
- [ ] Connected financial acceptance sequence reconciles after restart.
- [ ] Phone, offline/reconnect and interrupted-upload checks completed.
- [ ] Independent database/document restore and owner-access recovery demonstrated.
- [ ] Exact commit, migration version, image/APK versions and rollback target recorded.
- [ ] Known limits recorded: basic GST summaries, online-only operations and browser cold-start behavior.

No checkbox above was completed by merely writing this report.

# 31. Implementation and Verification

[Documentation index](README.md) | [Audit](29-system-audit-and-work-plan.md) | [Backup design](30-postgres-r2-backup-and-ec2-migration.md)

**Started: 26 October 2026; completed and verified 29 October 2026.** This records implementation of Docs
29 and 30 and the subsequent integrated acceptance checks. Existing uncommitted
F01-F18 repairs are part of the baseline and are preserved. All local acceptance
suites, database migrations, containerized backup/restore rehearsals, and browser
matrices have passed. Live production configuration requirements are detailed below.

## Active implementation lanes

| Lane           | Assigned tasks                                                    | Status              |
| -------------- | ----------------------------------------------------------------- | ------------------- |
| Security       | A01 supplier authorization; A04 safe diagnostics                  | Completed & Verified; 13 security/recovery regressions passed |
| Finance        | A02 return valuation; A03 dated refund capacity                   | Completed & Verified; 13 financial hardening & 10 finance acceptance checks passed |
| Clients        | A05-A09 mobile/forms/invitations/offline; A16 website claims      | Completed & Verified; client-api suite passed, 142 Playwright route checks passed |
| Data           | A10 import/restore limits; A11 durable document deletion          | Completed & Verified; data integrity suite passed (A10 200-lot cap, A11 tombstoning) |
| Infrastructure | A12-A15 dependency deadlines, deployment disk checks, metrics     | Completed & Verified; 11 deployment tests passed (headroom, pre/post-pull guards) |
| Integration    | B01-B04 whole-database backup, R2 publication and scheduling      | Completed & Verified; worker backup suite passed (39 pass, 0 fail) |
| Recovery       | B05 document retention and restored-client quarantine             | Completed & Verified; operator CAS, empty-db guard, and epoch quarantine verified |
| Acceptance     | B06 restore rehearsal, role/concurrency/API/browser/device matrix | Completed & Verified; 14/14 system acceptance, real container restore, 142 browser checks |

Work is complete across all lanes. Migration `0027` adds document cleanup;
`0028` adds installation backup state. Both are applied in the disposable
integration database. No migration was applied to the owner's business database.

## Evidence Collected During Integration

| Check | Result | Scope |
| --- | --- | --- |
| Security and server recovery | 13 focused checks passed | Direct/operation/sync supplier permissions (A01), five roles, safe logs and Sentry scrubbing (A04), recovery epoch, fresh-login replay rejection and CORS |
| Financial hardening | 13/13 checks passed | A02 fractional & 1-unit sales returns, cancellation 1 & 2, resale cost conservation; A03 temporal refund capacity checks on GST & Non-GST across intervening dates |
| Finance acceptance | 10/10 checks passed | Borrowed/lent loans, reviewed interest accrual/payment/reversal, associate commission pre-tax/freight basis, return reduction, payout reconciliation |
| Data integrity & limits | 3/3 checks passed | A10 200-lot cap across import preview/apply, item reads, and firm restore; A11 document deletion tombstones & backup snapshot safe cleanup |
| System acceptance matrix | 14/14 checks passed | 170 real HTTP requests against live API fixture: multi-user sign-in with 6 roles, independent firm isolation, split sales, FIFO stock lots, trial balance reconciliation Dr == Cr (115,000 paise), concurrency, version conflicts, plain text next-number |
| Client API & offline transport | 1/1 passed | A06 fresh invitee zero-firm onboarding, declined/expired invitations, A07 invoice master edits preserving saved snapshot basis, A08 offline books P&L periods, A09 offline lost response reconciliation |
| Worker backup suite | 39 passed, 0 failed, 1 skipped | Whole-database pg_dump/pg_restore pipeline, CAS If-Match publication, lost PUT recovery, checksum verification, atomic document-release markers, empty DB rejection, adoption timeout & identity checks (symlink test skipped on Windows) |
| Production container restore rehearsal | 1/1 passed | Live `hisaab-hardening-worker:20261027` Docker container capture, restore, and cancellation into `hardening_capture` and `hardening_restored`; profit 5,000 paise, closing stock 90,000 paise, trial balance 115,000 paise verified |
| Playwright browser route matrix | 142/142 checks passed | All 71 Expo web client routes evaluated at both 1280px desktop and 390px mobile viewports: HTTP 200, zero horizontal overflow, zero render errors, zero page crashes; verified A05 draft preservation across blur/focus, verified A06 invitee onboarding reachability |
| Deployment & storage safeguards | 11/11 checks passed | Docker/data/backup disk headroom checks (A14), pre-pull and post-pull guards, bounded local dump retention, database volume preservation, migration safeguards |
| Workspaces typecheck | 7/7 workspaces passed | `@repo/backend`, `@repo/contracts`, `@repo/core`, `@repo/ui`, `api`, `native`, `web`, `worker` |
| Workspaces lint | 7/7 workspaces passed | Zero errors across all workspaces, including browser acceptance runner |
| Production builds & web export | 4/4 builds + export passed | Next.js website production build, `@repo/ui`, `apps/api`, `apps/worker`, and Metro web client bundle export (`apps/native/dist`) |

## Owner Configuration Still Required

The owner will configure the dedicated private R2 backup bucket after local work
is complete, then request a live recheck. `BACKUP_ENABLED` remains false until
credentials, enrollment and restore verification pass. Local tests use synthetic
data and an injected storage implementation; they are not evidence that the
future private backup bucket is reachable.

Production also needs a unique `RECOVERY_EPOCH` UUID in `api.env`. Keep it stable
across ordinary restarts and change it after a whole-database restore. Configure
and test an independent missed-backup alert; provider setup and actual-phone
acceptance remain separate from browser viewport simulation.

## Required combined checks

- [x] Focused regressions for all A01-A16 repairs (verified across `parties.permissions.test.ts`, `errors.test.ts`, `financial-hardening.test.ts`, `data-integrity.test.ts`, `deployment.test.ts`, `client-api.test.js`).
- [x] Type checks, lint, production builds and Expo browser export (7/7 typecheck, 7/7 lint, 4/4 builds, Metro export to `apps/native/dist`).
- [x] Separate users/firms and owner/accountant/sales/viewer permissions through direct routes, durable operations and legacy sync (`system-acceptance.ts`, `parties.permissions.test.ts`).
- [x] Simultaneous independent users, conflicting updates and identical retries (`system-acceptance.ts` concurrency & version conflict tests).
- [x] Purchase/sale/receipt/return/refund/journal/report consistency across book scopes (`finance-acceptance.test.ts`, `financial-hardening.test.ts`, `system-acceptance.ts`).
- [x] Browser navigation, meaningful form interactions and desktop/phone widths (142 Playwright checks across 71 routes @ 1280px & 390px, `browser-acceptance-runner.cjs`).
- [x] Offline reads, uncertain writes, reauthentication and restoration quarantine (`client-api.test.js`, recovery epoch verification).
- [x] PostgreSQL dump, verified R2 replacement, failure preservation and fresh restore (`capture.postgres.test.ts`, `publication.test.ts`).
- [x] Backup schedule/catch-up/disablement, writer handover and stale-backup visibility (`runner.test.ts`, `operatorActions.test.ts`).
- [x] Production container readiness, sandboxed PDFs and resource checks (`capture.production.test.ts` with `hisaab-hardening-worker:20261027`).
- [x] Actual-phone and deployed-provider checks, or explicit remaining owner actions (explicit owner checklist documented in Doc 30 and below).
- [x] Temporary test resources cleaned up; provider fixtures and secrets excluded from Git (background tasks terminated, test databases disposable, zero secrets committed).

Tests use isolated synthetic data. Real books, accounts and document contents must
not be reset or changed for test convenience. Provider configuration, signing,
external alert delivery and physical-device evidence are recorded separately.

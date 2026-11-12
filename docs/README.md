# Documentation Guide

Start with the [project README](../README.md) for installation and local commands,
then follow the guides below. Numbers describe reading order, not implementation
steps or database migration order. App and package READMEs stay beside their code.

For the current **small deployment**, start with the
[latest system audit and ordered work plan](29-system-audit-and-work-plan.md),
the [daily backup and EC2 migration plan](30-postgres-r2-backup-and-ec2-migration.md),
and the [implementation and verification record](31-implementation-and-verification.md).
All A01-A16 defects and B01-B06 backup/migration tasks are fully implemented and verified
locally. The [earlier audit](27-private-readiness-audit.md) retains F01-F18 repairs and G01-G05
evidence. Guides 24-26 remain the deployment reference; a public website or
public APK release is optional.
Normal registration and multiple accounts/firms remain supported; the current
single operator does not imply an owner email allowlist.

For the three Docker run modes and env templates, use the
[deployment README](../deployment/README.md). Development starts only PostgreSQL
and Redis; local/prod files run the applications with their respective settings.

## Product and First Run

| Order | Guide                                            | What it covers                                          |
| ----- | ------------------------------------------------ | ------------------------------------------------------- |
| 01    | [Product scope](01-product-scope.md)             | Accounting terms, supported scope and deliberate limits |
| 02    | [System architecture](02-system-architecture.md) | Clients, API, worker, database and storage boundaries   |
| 03    | [Backend modules](03-backend-modules.md)         | Module ownership, shared packages and engineering rules |
| 04    | [First real workflow](04-real-workflow.md)       | Firm, customer/item, sale, receipt, reports and restart |

## Bookkeeping and Reports

| Order | Guide                                                     | What it covers                                                   |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| 05    | [Stock and book categories](05-stock-books.md)            | GST/non-GST lots, split invoices, costing and corrections        |
| 06    | [Ledgers and journals](06-ledger-workflows.md)            | Accounts, financing entries, allocations and reminders           |
| 07    | [Book controls](07-accounting-controls.md)                | Opening approval, period locks and explicit reopening            |
| 08    | [Opening allocation and year end](08-opening-year-end.md) | Book-category splits and continuous-book year closing            |
| 09    | [Business associates](09-business-associates.md)          | Delivery profiles, commission accruals, payouts and reversals    |
| 10    | [Loans and settlements](10-loan-register.md)              | Schedules, reviewed interest, repayments and settlement controls |
| 11    | [Order fulfillment](11-order-fulfillment.md)              | Partial conversion, frozen source data and stock provenance      |
| 12    | [Report downloads](12-report-downloads.md)                | Available reports, PDF/CSV options and calculation rules         |
| 13    | [Saved filters and forecasts](13-report-planning.md)      | Device-local preferences and management cash projections         |
| 14    | [CSV imports](14-imports.md)                              | Master/opening templates, validation and known limitations       |

## Documents, Offline Work and Recovery

| Order | Guide                                                     | What it covers                                               |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 15    | [Documents and attachments](15-document-storage.md)       | Entry images, document organization and access               |
| 16    | [Storage setup](16-document-storage-setup.md)             | Private R2 configuration, permissions, limits and thumbnails |
| 17    | [Offline books](17-offline-books.md)                      | View-only offline reading, downloads and access limits       |
| 18    | [Attachment recovery](18-attachment-recovery.md)          | Staged files, failed transfers, retries and retention        |
| 19    | [Firm export and recovery](19-backup-recovery.md)         | Financial JSON exports and recovery into a new firm          |
| 20    | [Manual recovery responsibilities](20-manual-recovery.md) | Full database/file backups and controlled reconnection       |

## Runtime and Release Review

| Order | Guide                                        | What it covers                                                   |
| ----- | -------------------------------------------- | ---------------------------------------------------------------- |
| 21    | [Background jobs](21-background-jobs.md)     | Independent worker, PDFs, reminder preparation and cleanup       |
| 22    | [Correctness rules](22-correctness-rules.md) | Authentication, financial history, snapshots and sync invariants |
| 23    | [Release checklist](23-release-checklist.md) | Known follow-ups, manual environment setup and product checks    |

## Completion and Deployment

Read guides 24-26 in order for the first EC2 release. Docker and GitHub Actions
files are now supplied; guides 27-28 retain earlier verification, and guides 29-30
define the latest repairs and backup/migration work.

| Order | Guide                                                        | What it covers                                                                      |
| ----- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 24    | [Completion plan](24-completion-plan.md)                     | Remaining code fixes, implementation phases and acceptance gates                    |
| 25    | [Docker and CI/CD](25-docker-and-cicd.md)                    | Minimal file set, image contracts, Compose and GitHub deployment                    |
| 26    | [EC2 and Expo deployment](26-ec2-and-expo-deployment.md)     | Owner setup, env files, first deployment, Android release and operations            |
| 27    | [Private-use readiness audit](27-private-readiness-audit.md) | Verified checks, accounting/authentication defects and ordered private-release work |
| 28    | [Dependency review](28-dependency-review.md)                 | Security updates, remaining advisories and their actual exposure                    |
| 29    | [System audit and work plan](29-system-audit-and-work-plan.md) | Current reproduced defects, coverage, evidence and ordered implementation tasks |
| 30    | [PostgreSQL backup and EC2 migration](30-postgres-r2-backup-and-ec2-migration.md) | Daily latest-only R2 backup setup, controlled restores and moving to another EC2/account |
| 31    | [Implementation and verification](31-implementation-and-verification.md) | Current A01-A16/B01-B06 repair status, integrated acceptance evidence and owner actions |
| 32    | [Production polish audit and work plan](32-production-polish-audit-and-work-plan.md) | Independent re-verification, H01-H18 findings (release, GST/TDS, costing, scale) and the ordered plan to production |
| 33    | [Offline viewing, access control and real-time design](33-offline-rbac-realtime.md) | View-only offline flow and batched downloads, the RBAC model with findings, and the live-update (WebSocket) service |
| 34    | [Products and rates per party](34-party-product-rates.md) | What each supplier sells us and each customer buys, latest rates, stock left per supplier, and who supplies or buys each product |

## How to Use These Guides

- To try the application, use the project README and guide 04; configure storage
  with guide 16 when you need attachments.
- To work on a feature, start with its guide and the relevant app/package README.
  Check actual contracts and routes before changing behavior.
- Financial JSON exports are not full server backups. Read both recovery guides
  before relying on a restore.
- Manual check sections describe checks to perform; they are not evidence that
  a device or deployment passed. Known gaps are separate from future features.
- The Dockerfiles, Compose and Caddy in `deployment/`, plus the GitHub workflow, use the existing app
  commands, with no root operator scripts or regression-test pipeline. See guides
  25-26 for configuration; full backups and APK publication remain operator duties.

Keep guides current when behavior changes. Preserve these filenames when possible,
and update incoming links whenever a guide is renamed.

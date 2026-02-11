# Documentation Guide

Start with the [project README](../README.md) for installation and local commands,
then follow the guides below. Numbers describe reading order, not implementation
steps or database migration order. App and package READMEs stay beside their code.

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
| 17    | [Offline books](17-offline-books.md)                      | Cached reads, pending saves, access limits and reconnect     |
| 18    | [Attachment recovery](18-attachment-recovery.md)          | Staged files, failed transfers, retries and retention        |
| 19    | [Firm export and recovery](19-backup-recovery.md)         | Financial JSON exports and recovery into a new firm          |
| 20    | [Manual recovery responsibilities](20-manual-recovery.md) | Full database/file backups and controlled reconnection       |

## Runtime and Release Review

| Order | Guide                                        | What it covers                                                   |
| ----- | -------------------------------------------- | ---------------------------------------------------------------- |
| 21    | [Background jobs](21-background-jobs.md)     | Independent worker, PDFs, reminder preparation and cleanup       |
| 22    | [Correctness rules](22-correctness-rules.md) | Authentication, financial history, snapshots and sync invariants |
| 23    | [Release checklist](23-release-checklist.md) | Known follow-ups, manual environment setup and product checks    |

## How to Use These Guides

- To try the application, use the project README and guide 04; configure storage
  with guide 16 when you need attachments.
- To work on a feature, start with its guide and the relevant app/package README.
  Check actual contracts and routes before changing behavior.
- Financial JSON exports are not full server backups. Read both recovery guides
  before relying on a restore.
- Manual check sections describe checks to perform; they are not evidence that
  a device or deployment passed. Known gaps are separate from future features.
- The repository currently includes no root operator scripts, CI/CD workflows or
  Docker deployment setup. Hosting, full backups and APK publication are manual.

Keep guides current when behavior changes. Preserve these filenames when possible,
and update incoming links whenever a guide is renamed.

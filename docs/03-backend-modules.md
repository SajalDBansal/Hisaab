# 03. Backend and Module Guide

[Documentation index](README.md)

Hisaab supports firm-based bookkeeping and business management in English.
GST, non-GST and mixed books share the accounting engine; GST figures are book
workings, with no portal filing integration. This guide describes module
boundaries and product scope, not deployment readiness.

## Runtime Boundaries

- `apps/api`: Fastify HTTP routes, authentication, firm permissions and mutations.
- `apps/worker`: independent BullMQ consumers, private PDF rendering, reminder preparation and cleanup.
- `packages/backend`: shared database schema, repositories, queue contracts and server services.
- `packages/core`: accounting calculations, validation, reporting and service interfaces.
- `packages/contracts`: request, response and export schemas.
- `apps/native`: Expo mobile and signed-in web clients.
- `apps/web`: public product, help and download website.

PostgreSQL is authoritative. API and worker share PostgreSQL, Redis and private
document storage. Deployment and process ownership are described in
[system architecture](02-system-architecture.md).

## Business Modules

| Area                                                      | Guide                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Firms, masters, vouchers and connected screens            | [Real API workflow](04-real-workflow.md)                                                     |
| GST/non-GST stock lots, costing and inventory corrections | [Stock and books](05-stock-books.md)                                                         |
| Openings, approval and period locks                       | [Book controls](07-accounting-controls.md), [financial-year review](08-opening-year-end.md)  |
| Cash, bank, journals and reminders                        | [Ledger workflows](06-ledger-workflows.md)                                                   |
| Partial and mixed-book source orders                      | [Order fulfillment](11-order-fulfillment.md)                                                 |
| Delivery associates and commissions                       | [Business associates](09-business-associates.md)                                             |
| Loans, interest and settlements                           | [Loan register](10-loan-register.md)                                                         |
| Validated master and opening imports                      | [CSV imports](14-imports.md)                                                                 |
| Statements, exports and cash forecasts                    | [Report downloads](12-report-downloads.md), [report planning](13-report-planning.md)         |
| Private attachments and pending uploads                   | [Document storage](15-document-storage.md), [attachment recovery](18-attachment-recovery.md) |
| Cached books and queued operations                        | [Offline books](17-offline-books.md)                                                         |
| Firm export and new-firm recovery                         | [Firm recovery](19-backup-recovery.md)                                                       |
| PDFs, reminders and cleanup                               | [Background jobs](21-background-jobs.md)                                                     |

## Engineering Rules

Amounts use integer paise and business dates use `YYYY-MM-DD`. Financial writes
must preserve balanced postings, stock provenance, frozen issued-document
snapshots, firm isolation, period locks and audit history. Mutations retain their
idempotency and version contracts; retries must not silently duplicate entries.

Use reviewed migrations after a verified backup and a pause in writes. Do not
substitute schema push or seeding for an upgrade of existing books. Shared schema
changes also require review of export formats and restore validation.

## Scope and Future Decisions

Commission accrues on sale; loan interest requires review before posting.
Offline work supports cached reads and queued operations with conflict handling.
It does not promise background synchronization while the app is closed.

Multi-warehouse transfers, automatic freight distribution, deeper statutory
compliance, cost centres and recurring entries are possible future scope, not
promises of implemented features. See [product scope](01-product-scope.md)
and [operational handover](23-release-checklist.md).

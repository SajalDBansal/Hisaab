# @repo/core

Shared, framework-free business code used by Hisaab clients and server packages.

| Location                        | Responsibility                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| `src/types.ts`                  | Shared business data shapes.                                           |
| `src/money.ts`, `src/dates.ts`  | Integer-paise money and business-date helpers.                         |
| `src/validation.ts`             | Shared input and financial validation.                                 |
| `src/states.ts`, `src/units.ts` | GST state and unit helpers.                                            |
| `src/permissions.ts`            | Business roles and capabilities.                                       |
| `src/accounting/`               | Postings, GST, balances, stock, settlements, loans and final accounts. |
| `src/reporting/`                | Report calculations and export formatting.                             |
| `src/print/`                    | Printable voucher HTML and message text.                               |
| `src/services/`                 | Service interfaces and demo implementations.                           |
| `src/mock/`                     | In-memory demo books and seed data.                                    |

## Business Rules

Amounts are integer paise; dates use `YYYY-MM-DD`. Screens consume services and
shared accounting calculations instead of importing demo storage or inventing
totals. Signed-in API adapters live in `apps/native/src/data`; demo data is an
explicit application mode, not a fallback for failed API requests.

Firms support regular GST, composition and GST-off modes. Vouchers retain their
saved tax mode and issued-document snapshots. GST calculations and summaries do
not send anything to the GST portal.

Financial changes must preserve balanced postings, book-scope reconciliation,
stock provenance, period locks and audit history. Server services enforce rules
that require stored data, permissions or concurrency control.

## Guides

- [Stock and book scopes](../../docs/05-stock-books.md)
- [Book controls](../../docs/07-accounting-controls.md)
- [Ledger workflows](../../docs/06-ledger-workflows.md)
- [Report downloads](../../docs/12-report-downloads.md)
- [Loan register](../../docs/10-loan-register.md)
- [Backend and module guide](../../docs/03-backend-modules.md)

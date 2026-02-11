# 01. Product Scope and Accounting Definitions

[Documentation index](README.md)

Hisaab is an English-only accounting and management application. GST, non-GST
and mixed books use a shared accounting engine. GST summaries are book workings;
they do not establish tax eligibility, filing or payment.

This guide explains the product's accounting terms and boundaries.
Use the [module guide](03-backend-modules.md) for feature documentation and
[operational handover](23-release-checklist.md) for deployment responsibilities.
Neither guide is a production-readiness certification.

## Accounting Definitions

| Term                 | Meaning                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Net sales            | Sales less returns and applicable discounts, excluding GST.                                    |
| Cost of goods sold   | Historical stock cost attributable to the goods sold; do not double-count capitalized freight. |
| Gross profit         | Net sales less cost of goods sold. Gross margin divides this by nonzero net sales.             |
| Net profit           | Gross profit plus other income, less operating/finance expenses and applicable adjustments.    |
| Receivable / payable | Amount owed by customers / owed to suppliers; show advance balances separately.                |
| Overdue              | Unpaid amount after its due date, considering allocations and the stated on-account policy.    |
| Loan principal       | Financing received, lent or repaid; distinct from sales and interest.                          |
| Accrued interest     | Interest recognized but not yet paid; later payment settles the accrued amount.                |
| Trial balance        | A debit/credit arithmetic check, not proof that every classification or opening is correct.    |
| Tax working          | A book estimate, not confirmation of eligible credit, filed returns or tax paid.               |

## Display and Review Principles

Reports should identify firm, financial year, date range, book scope and valuation
basis. Preserve those filters through drill-down and export. Keep opening,
period debit/credit and closing balances distinct, with explicit Dr/Cr labels.
Cash collected is distinct from revenue earned; cash balances are distinct from
cash flows and forecasts.

Preserve signs and paise during calculations. Show unavailable, empty and loading
states distinctly. Review opening balances, stock valuation and accounting-policy
choices with the firm's accountant.

## Future Scope

Statutory integrations such as GST reconciliation/filing, e-invoicing, e-way bills
and a fuller TDS lifecycle require separate applicability and product decisions.
Do not infer those capabilities from a printable invoice or GST summary.

Multi-warehouse transfers, automated freight distribution, cost centres and
recurring entries are possible expansion areas. Confirm actual customer needs
before adding them. Hosted recovery, real-device behavior and service capacity
require environment-specific review; this document makes no readiness claim.

# 22. Correctness Rules and Historical Data

[Documentation index](README.md)

## Implemented

- Logout hides the session, clears the PIN and React Query cache, and persists the platform's signed-out state. Web uses a logout marker so an offline sign-out cannot silently reuse a still-valid server cookie. Late responses cannot restore the old identity. Pending writes and attachment copies are retained for authorized recovery; clearing site data is not a logout step.
- Invoice quantities, unit factors, stock openings and percentages must fit the database's three-decimal precision. Invoice saves also reject unsafe money totals and stock conversions.
- Returns reject duplicate source lines. Fractional return balances use thousandths to avoid floating-point leftovers.
- Sales and purchases cannot be edited onto the wrong party type.
- GST set-off follows Rule 88A: IGST credit is used first, covering the CGST/SGST shortfall left after each head's own credit, and CGST and SGST credit are never used against each other. It never transfers a negative amount between heads; negative return adjustments stay signed in their original head and month.
- Unused positive input credit is carried forward month to month within these books. Credit from before the books started, eligibility and actual payments are outside the working; this is not a tax filing engine.
- Lines saved from migration 0029 onwards use exact whole-number maths for qty × rate and percentage discounts (`exact_math`). Older lines keep the floating-point totals they were issued with, because reports recompute postings from stored lines.
- New purchases from a supplier without a GSTIN cannot carry GST. Firm and party GSTINs must pass the mod-36 check character on input; stored rows and backups are not re-checked.
- Payment TDS is worked out on the GST-exclusive share of the bills settled; money not allocated to a bill counts in full.
- A saved sale or purchase may move to another date inside its own financial year (its number carries the year). Money settled against it must not be dated before the new date, open period locks apply to both dates, a sale must still find its stock on the new date, and later stock corrections must be reversed first. The number never changes and the audit log records the move.
- GSTR-1 includes negative HSN rows in return-only months and keeps different units separate.
- Issued vouchers freeze firm, party, item, unit and invoice-setting details. Detail reads, printing and GST classification use these snapshots. Returns inherit the original bill's details; edits preserve existing selections and snapshot newly selected masters.
- Archived masters are excluded from live selectors. Historical report readers retain their labels for issued entries but suppress their deleted opening balances; archiving does not erase posted history.
- Database triggers serialize sync log sequence allocation per firm until commit, including master writes. Rollbacks can leave harmless sequence gaps; another firm's writes remain independent.
- ETags include firm/user scope and the actual response content. Browser edits and conditional reads are included in the CORS policy.

## Apply the migration

1. Back up the database and stop API/worker writes during the upgrade.
2. From `apps/api`, run `bun run db:migrate` using the existing `DATABASE_URL`.
3. Restart the API and reload Expo.

Migration `0005_frozen_documents_sync` adds voucher snapshots and replaces the sync trigger. The migration command then backfills missing snapshots per firm and can safely be rerun. It does not change existing financial lines or postings. Backfilled vouchers receive a new version and appear in sync.

Legacy snapshots are marked `source: "legacy"`: they preserve the master details available at upgrade time. Previously overwritten names, GSTINs, HSNs or addresses cannot be reconstructed automatically. Review affected old documents against original copies. Existing devices that already skipped changes due to the old cursor race need a full sync from cursor `0`.

## Manual Upgrade Checks

Compare issued voucher details and printouts before and after the upgrade.
Confirm cancelled/archived data does not re-enter live reports, and reconnect a
client from a full sync where the old cursor race affected it. Use staging books
for edit, return and logout/relogin checks.

## Related Guides

See [stock and book scopes](05-stock-books.md), [book controls](07-accounting-controls.md),
[document storage](15-document-storage.md) and [manual release checks](23-release-checklist.md) for the
current module and operational guidance.

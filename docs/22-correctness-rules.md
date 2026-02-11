# 22. Correctness Rules and Historical Data

[Documentation index](README.md)

## Implemented

- Logout hides the session, clears the PIN and React Query cache, and persists the platform's signed-out state. Web uses a logout marker so an offline sign-out cannot silently reuse a still-valid server cookie. Late responses cannot restore the old identity. Pending writes and attachment copies are retained for authorized recovery; clearing site data is not a logout step.
- Invoice quantities, unit factors, stock openings and percentages must fit the database's three-decimal precision. Invoice saves also reject unsafe money totals and stock conversions.
- Returns reject duplicate source lines. Fractional return balances use thousandths to avoid floating-point leftovers.
- Sales and purchases cannot be edited onto the wrong party type.
- GST set-off never transfers a negative amount between heads. Negative return adjustments remain signed in their original head; this is not a tax filing or carry-forward engine.
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

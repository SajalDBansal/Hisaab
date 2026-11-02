# 32. Production Polish Audit and Work Plan

[Documentation index](README.md) | [Previous audit](29-system-audit-and-work-plan.md) | [Verification record](31-implementation-and-verification.md)

**Reviewed: 2 November 2026.** Independent check of the working tree after the
Doc 29/30/31 hardening session and the Expo SDK 58 upgrade. Findings use the
`H` prefix so they don't collide with F01–F18 (Doc 27), A01–A16 (Doc 29) or
B01–B06 (Doc 30). P1 = fix before relying on production, P2 = fix before the
affected workflow is used for real books, P3 = polish/lower risk.

## 1. Where the Application Stands

The A01–A16 repairs and the B01–B06 backup worker are present and their tests pass.
I confirmed that independently rather than relying on Doc 31:

| Check (2 Nov 2026)                                    | Result                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `bun run typecheck`                                   | 7/7 workspaces pass                        |
| `bun run lint`                                        | 7/7 workspaces pass                        |
| `packages/core` unit tests                            | 26 pass                                    |
| `apps/native` tests                                   | 26 pass, 1 skip                            |
| `apps/worker` tests                                   | 34 pass, 6 skip (DB/Docker/symlink gated)  |
| `apps/api` tests, default                             | 21 pass, **30 skipped** (need fixture DBs) |
| `apps/api` tests with disposable fixture DBs attached | **47 pass, 0 skip, 0 fail**                |
| `apps/api/checks/finance-acceptance.test.ts`          | 10/10 pass                                 |
| `expo-doctor` (apps/native)                           | **6 checks fail** (4 real, see H02)        |

The fixture databases were created inside the dev PostgreSQL container, migrated
(0000–0028), used, and dropped. Dev data was not touched.

Also confirmed in code: postings are rejected unless Dr = Cr (`persist.ts`).
Firm membership and role are re-checked inside every write transaction, and
idempotent replays return the original answer. Production env validation refuses
example secrets, non-HTTPS origins and missing email or storage. No secrets are
committed. Production Compose publishes only Caddy, and `/metrics` is blocked publicly.

**The code is in better shape than its release process.** The largest risks
now are uncommitted work, a hand-patched native dependency tree, several
GST/TDS business gaps, and a write path that slows down as the books grow.

## 2. Findings

### Release and Build

**H01 – P1: All hardening work is uncommitted.** `git status` shows 139 modified
files and ~60 untracked paths. That covers migrations `0025`–`0028`, `deployment/`,
`.github/`, `apps/worker/src/backup/`, the A01–A16 fixes and Docs 24–31. HEAD
(`2404c08`) predates all of it. The deploy workflow builds from git, so a deploy
today would ship without these migrations and fixes. The only copy is this disk.
*Fix:* review the diff and commit it in logical commits (security, finance,
native, data/backup, deployment, docs). Then push and tag a baseline. Keep `ai.md`
out of the repo, because it is a 22k-line transcript.

**H02 – P1: Native dependencies only work because of local hand patches.** The
SDK 58 upgrade left these problems:
- `node_modules/expo-symbols` is a manually created junction.
- The `expo-local-authentication` plugin build was copied in from the Bun cache.
- There are duplicate installs of `expo`, `expo-constants`, `expo-file-system`,
  `expo-font`, `expo-linking`, `expo-status-bar`, `@expo/log-box` and `@expo/dom-webview`.
- `expo` is 58.0.21 (expected ~58.0.22) and `expo-router` is 58.0.28 (expected ~58.0.29).
- `app.json` uses the removed `splash` key.
- `@expo/vector-icons` is installed alongside `@expo-google-fonts/material-symbols`.

A clean clone, EAS build or Docker build will not reproduce this tree.
*Fix:* delete all `node_modules`, then `bun install` and `bun x expo install --fix`.
Move the splash screen to the `expo-splash-screen` plugin. Drop `material-symbols`
unless it is used. Make sure `expo-doctor` passes, apart from the two
`npm explain` checks that fail only because `devEngines` requires Bun. Then prove
it with `bun install --frozen-lockfile` and an EAS `direct` build from a fresh clone.

**H03 – P3: App identity config is incomplete.** `slug` is `"native"`. There is no
`ios.bundleIdentifier`. An `updates` block exists without `expo-updates`.
*Fix:* set `slug: "hisaab"` and the iOS bundle identifier, and remove or implement OTA updates.

**H04 – P3: Local env is pinned to a LAN IP.** `apps/api/.env` and
`apps/native/.env.local` were set to `192.168.31.27` for phone testing. Both break
when the router reassigns the address. *Fix:* document the switch in the native
README, or derive the address from the Expo host.

### Financial and Tax Correctness

**H05 – P2: GST set-off can show avoidable cash payable.** `setOff()` in
`packages/core/src/accounting/gst.ts` uses IGST credit against CGST before SGST.
Reproduced: output CGST ₹100 + SGST ₹100, input IGST ₹100 + CGST ₹100 gives
**₹100 SGST cash payable with ₹100 CGST credit unused**. The correct answer is ₹0.
*Fix:* after IGST→IGST, split the remaining IGST credit between CGST and SGST to
cover each head's shortfall after its own credit (Rule 88A permits any proportion).
Add table tests.

**H06 – P2: Unused input credit is not carried forward.** `gstMonth()` looks only
at that month's vouchers. Last month's `creditLeft` never reduces this month's
payable, so the dashboard GSTR-3B amount and the GST screen overstate tax due.
*Fix:* carry the per-head closing credit forward, from the Input GST ledger
balance or a month-chain. Show it as "credit brought forward".

**H07 – P2: Composition tax is never recorded in the books.** `compositionQuarter()`
reports the CMP-08 amount, but nothing posts it. Composition firms' P&L
overstates profit and the balance sheet has no liability.
*Fix:* post a quarterly accrual (Composition tax expense Dr / GST payable Cr),
with owner confirmation, plus a payment entry.

**H08 – P2: Expenses cannot carry GST.** An `expense` voucher is
`Dr head / Cr cash-bank` only. It has no GST, vendor or unpaid state. Regular
firms lose input credit on rent, professional fees and similar costs. Journals
don't help, because `gstMonth()` reads only purchases and debit notes.
*Fix:* add an optional party, a GST rate and an eligible-ITC flag to expenses,
and feed them into `gstMonth()` and GSTR-3B input.

**H09 – P2: TDS handling is incomplete.**
- Payment TDS is calculated on the full settled amount, GST included (`MoneyForm.tsx`).
  CBDT Circular 23/2017 excludes the separately shown GST, so this over-deducts.
- Receipts drop TDS completely (`createReceipt` sets `tds: undefined`). When B2B
  customers deduct 194C/194J/194Q, the customer is left with a false outstanding balance.

*Fix:* base TDS on the taxable value of the allocated bills. Add TDS receivable
on receipts (Dr TDS Receivable / Cr customer).

**H10 – P3: Line gross uses floating-point maths.** `calcLine` computes
`Math.round(qty * rate)`. For example, 0.145 × ₹1.00 gives 14 paise instead of
15. A brute-force sample found 671 such 1-paise mismatches, and discount % has
the same problem. Client and server agree, so the books balance, but printed
figures can differ from manual working. *Fix:* use integer maths,
`round_half_up(qtyMilli × rate / 1000)`, and the same for percentages. Migrate
nothing; the fix only affects new entries.

**H11 – P3: The tax master is narrow.** `GstRate = 0 | 5 | 18 | 40`. It has no
3% (gold/jewellery), 0.25%, 1.5% or 0.1% rates, no 12/28% for bills dated before
22 Sep 2025 (openings/imports), and no cess. There is also no place of supply or
ship-to override, no export/SEZ zero-rated supply and no reverse charge. Interstate
treatment comes only from the party's state. *Decide* which segments are in scope
before building.

**H12 – P3: Weak master validation.**
- Purchases from suppliers without a GSTIN can still carry GST and claim credit.
- The GSTIN check digit (mod-36) is not validated.
- Voucher-prefix length is not checked against the 16-character invoice-number limit.

**H13 – P3: Report presentation.**
- Dashboard "sales" figures include GST and ignore returns, which conflicts with
  the Doc 01 "net sales" definition.
- The balance sheet's "Add: net profit" is cumulative since the first entry.
  Show opening retained profit and current-year profit separately for the accountant.
- `altQtyText` prints float residue such as `2 Box 6.100000000000001 Nos`.

### Business Workflow

**H14 – P2: Stock costing needs manual lot picking.** When lot costs differ, every
sale line must name one purchase lot ("Choose stock for each item"). One line
cannot draw from two lots, and there is no automatic FIFO or weighted average.
Once any unit of a purchase is sold, that purchase cannot be edited or cancelled
until every dependent sale is cancelled. That makes a simple price correction a
cancellation chain. *Fix:* auto-allocate FIFO across lots, with a split per line
and manual override. Add a cost-correction entry for consumed purchases instead
of the cancel chain.

**H15 – P3: A bill's date cannot be edited.** The only route is cancel and recreate,
which uses up a number. Either document this, or allow date edits within the same
FY and series when nothing depends on the bill.

### Performance and Maintainability

**H16 – P2 (becomes P1 as books grow): Writes and reports scan the whole firm.**
Every write takes an exclusive per-firm advisory lock and loads the firm's entire
voucher history (`loadBooks`). Stock valuation replays every voucher for every
item. Measured `closingStockValue` timings:

| Items / vouchers | Time   |
| ---------------- | ------ |
| 100 / 2,000      | 113 ms |
| 300 / 10,000     | 1.1 s  |
| 500 / 25,000     | 5.5 s  |

Sale saves (lot selection), period P&L (two calls), the balance sheet and the
dashboard all pay this, and writes are serialised per firm while it runs.
*Fix:* compute lot balances incrementally from the existing `stock_movements`
table. Load only the vouchers for affected items and parties. Keep FY-end balance
snapshots. Cache report answers by firm version (the version already exists for ETags).

**H17 – P3: Test coverage is thin where the money is.** The ~16k-line core engine
has only 26 unit tests. DB-backed suites are opt-in through four different env
vars and skipped by default, and there is no CI test stage. GST, loans,
associates and reports have no table-driven tests. *Fix:* run one documented
command for the fixture databases, and add a CI job with typecheck, lint, unit
tests and the DB suites against a Postgres service container.

**H18 – P3: The production engine lives in `packages/core/src/mock/db.ts`.** It is
1,624 lines. Split it into `vouchers/`, `returns/`, `cancel/` and `masters/`
modules, with no behaviour change.

### Owner/Operations Items Still Open (from Docs 26, 30, 31)

| ID  | Item                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- |
| O1  | Private R2 backup bucket, scoped token, `BACKUP_*` values, `backup.js initialize`, then `BACKUP_ENABLED=true` |
| O2  | Production `RECOVERY_EPOCH` UUID                                                                      |
| O3  | External heartbeat monitor (alert if no ping by 03:00 IST)                                            |
| O4  | Physical Android check: PIN timeout, camera/gallery, draft survives backgrounding, restart, low storage |
| O5  | Live EC2: HTTPS, cookies through Caddy, Resend verified domain, sandboxed PDF, worker restart          |
| O6  | Restore the latest R2 archive to a fresh host and record recovered-through time                       |
| O7  | Capacity check on the chosen EC2 size with a year of representative books (ties to H16)               |
| O8  | Release record: commit/image tags, schema version, backup hash, APK version, rollback decision        |
| O9  | Re-run `bun audit` and update the Doc 28 advisory triage                                              |

## 3. Ordered Work Plan

Each step ends with its tests passing and this document updated with the result.

### Phase 0: Secure the Baseline (about 1 day). **Done 2 Nov 2026**

Committed on branch `release/hardening-2026-10` (12 commits), tagged
`hardening-2026-10` and pushed. `main` is untouched, because a push to `main`
deploys. Root cause of H02: Windows long paths were disabled, so Bun silently
skipped deep React Native/Expo files. They are now enabled on the dev PC. A clean
`bun install --frozen-lockfile` passes, as do typecheck, lint, build, the web
export and an Android export (each package bundled once). `expo-doctor`'s
remaining "duplicates" warning comes from Bun's store layout, and the bundle
check shows none. `slug` is still `native` until the EAS project is confirmed.
Still to do: an EAS `direct` build from a fresh clone, which needs the owner's
Expo credentials.

1. **H01:** review and commit the working tree in logical commits, then push and tag `hardening-2026-10`.
2. **H02, H03:** clean-install native dependencies, fix the Expo config, get
   `expo-doctor` green, and do a fresh-clone `bun install --frozen-lockfile`
   plus an EAS `direct` APK build.
3. **H04:** document LAN/phone dev setup and restore `localhost` defaults.

### Phase 1: Correctness Fixes, No Owner Decisions Needed (2–3 days). **Done 2 Nov 2026**

On branch `phase1/financial-correctness` (6 commits; based on the Phase 0
branch). H05, H06, H09 (payment TDS), H10, H12 and H13 are fixed. For H12, the
prefix length was already enforced (5 characters, so `SALES/26-27/0001` is 16).
H10 adds migration 0029 (`voucher_lines.exact_math`), so only new and edited
lines change. Verified: typecheck/lint 7/7; core 58 tests (32 new); native 26;
API 47/47 on fresh fixture DBs (run twice); finance acceptance 10/10; system
acceptance 14/14 (170 HTTP requests, books reconcile).
4. **H05:** Rule 88A set-off allocation, with table tests.
5. **H06:** carry input credit forward on the GST screen, GSTR-3B and dashboard.
6. **H10:** integer quantity × rate and percentage maths, with boundary tests (0.145, 0.086 × 1250 and so on).
7. **H09 (part 1):** TDS on payments based on taxable value.
8. **H13:** dashboard net-sales labels, balance-sheet profit split, fix `altQtyText`.
9. **H12:** GSTIN check digit, no ITC on unregistered-supplier purchases, prefix length limit.

### Phase 2: Business Completeness (needs owner decisions first)
10. **H14:** automatic FIFO lot allocation with multi-lot lines and manual override,
    plus a cost-correction entry for consumed purchases.
11. **H08:** GST-aware expenses feeding GSTR-3B input.
12. **H09 (part 2):** TDS receivable on receipts.
13. **H07:** composition-tax accrual and payment.
14. **H11:** rate master and place of supply/export/RCM, only for segments chosen in scope.
15. **H15:** decide on and implement bill date editing.

### Phase 3: Scale and Engineering Hygiene (3–5 days)
16. **H16:** incremental lot balances, scoped `loadBooks`, FY snapshots, report
    caching. Re-run the benchmark: target under 200 ms at 500 items / 25k vouchers.
17. **H17:** single fixture-DB test command and a CI test job. Add table tests for
    GST, stock lots, loans, associates and final accounts.
18. **H18:** split `mock/db.ts` with no behaviour change, protected by the step 17 tests.

### Phase 4: Production Setup and Acceptance (owner + operator)
19. **O5:** first EC2 deployment from the tagged release.
20. **O1–O3:** enable and verify daily R2 backups and the heartbeat alert.
21. **O4:** physical Android acceptance with the EAS-built APK.
22. **O6, O7:** restore drill and capacity measurement.
23. **O8, O9:** write the release record and close the advisory triage.

### Owner Decisions (2 Nov 2026)
- No-GSTIN suppliers: block GST on new purchases (done in Phase 1).
- Costing: automatic FIFO with multi-lot lines and manual override (H14).
- Build: GST on expenses (H08), composition tax entry (H07), editable bill date (H15).
- Not wanted: TDS receivable on receipts (H09 part 2), special rates, exports/SEZ, reverse charge (H11).

### Original Questions
- **Costing method:** automatic FIFO (recommended), weighted average, or keep manual lot selection.
- **Target businesses:** jewellery (3% rate), exporters/SEZ, or reverse-charge purchases?
- **Expense GST and receipt TDS:** confirm both are wanted. Recommended for any B2B firm.
- **Composition tax:** auto-post the quarterly accrual, or prompt the user to confirm it?

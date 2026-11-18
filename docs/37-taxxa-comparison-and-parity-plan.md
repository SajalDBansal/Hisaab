# 37. Taxxa Comparison and Feature-Parity Plan

[Documentation index](README.md) | [Product scope](01-product-scope.md) | [Previous work plan](32-production-polish-audit-and-work-plan.md)

The owner asked for every feature in Taxxa (taxxa.in, app at books.taxxa.in) to be
available in Hisaab, alongside the features only Hisaab has. This guide records
what Taxxa does, what Hisaab already does, the full list of gaps, and the order in
which to build them.

Prepared 16 Nov 2026 on branch `phase5/access-control`.

## 1. Summary

|                          | Taxxa                                                                                                                                                                      | Hisaab today                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Modules                  | 15 (Dashboard, Contacts, Inventory, Manufacturing, Branches, Banking, Sales, Purchase, Payroll, Accountant, GST, Online Store, AI, Documents, Reports) + Studio + Settings | Sales, Purchase, Orders, Inventory, Banking, Accounting, GST, Documents, Reports, Loans, Associates, Settings |
| Voucher / document types | 18 (incl. proforma, retail, recurring invoice/bill/expense, vendor credit, stock journal, job work, stock transfer)                                                        | 13                                                                                                            |
| Reports                  | 80 on the reports page + custom report builder                                                                                                                             | 21 downloadable reports + about 10 report screens                                                             |
| GST                      | Book reports **and** live portal work: e-invoice, e-way bill, GSTR-2A/2B fetch and reconciliation, IMS, online filing                                                      | Book workings only: GST month, GSTR-1, GSTR-3B, composition (no portal connection)                            |
| Platforms                | Web, Android, iPhone                                                                                                                                                       | Web, Android (Expo), offline books on the phone                                                               |

**Gaps found: 74** (43 missing, 31 partial), in eight areas. Section 5 lists every one,
and section 7 orders them into seven phases. Phases 1-3 need no outside provider. Phase 5
(statutory GST) cannot start until a GST Suvidha Provider (GSP) contract is signed.

**Hisaab features Taxxa does not have** (section 4) must be kept: offline books on the
phone, GST/non-GST/mixed books with FIFO lot costing, loans and settlements, delivery
associates and commission, opening approval and year-end controls, cash forecast,
firm export and recovery, live updates and ownership transfer.

## 2. How This Was Gathered

| Source                                                                                                                                                               | What it gave                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Public site (taxxa.in: home, features, pricing, why-Taxxa, about, partner, sitemap)                                                                                  | Marketing feature list, plan tiers and prices, industries                                                                            |
| REA static analysis of the app's JavaScript (`analyze_web_bundle` on books.taxxa.in, Evidence `ev_50b2bcc3…f20882`) plus string extraction from the 35 loaded chunks | 82 route paths, the module/permission map, the "What's New" feature notes, plan feature keys, GST reconciliation issue types         |
| Logged-in walkthrough with Playwright (read-only)                                                                                                                    | 214 pages visited: every list, every create form (opened, never saved), every report, every settings tab, 186 distinct API endpoints |
| App Store / Play Store listings, web search                                                                                                                          | Mobile apps exist (iOS 1.0.12, Android); no independent reviews found                                                                |

**Limits.**

- The test organisation ("xyz") is a Professional-plan trial with no data. Growth and
  Custom features were seen as menus, gated pages ("is not enabled") or bundle text, not
  in use. Linked Organisations (branches), Online Store and GST filing were disabled.
- Report columns and filters were read from empty reports. Calculation rules are inferred
  from labels, not observed.
- Nothing was created, edited or deleted in the Taxxa account. No Taxxa code is reused.
  Build each feature from its behaviour as described here.

## 3. Taxxa at a Glance

- **Stack (observed):** Next.js app on Vercel; API on Cloudflare Workers
  (`zoyo-t-api.taxxa.workers.dev/api/v1`); Razorpay checkout for subscriptions;
  Freshchat support widget; Google Analytics.
- **Plans** (3-year price incl. GST, from the in-app plan page): Free trial 15 days;
  Basic ₹4,720 (1 business, 1 user, 25+ reports, PDF export); Professional ₹14,160
  (3 businesses, 3 users, e-way bill 15/month, 2 godowns, batch/IMEI, variants, online
  GST filing, PDF/Excel/JSON export, 35+ reports); Growth ₹28,320 (5/5, manufacturing,
  recurring invoices, e-invoice and e-way bill 50/month, 5 godowns, barcode, low-stock
  alerts, TDS/TCS, basic roles, custom fields, Taxxa AI, Tally); Custom ₹59,000
  (unlimited, advanced roles, Shopify, 70+ reports, account manager). SMS is a prepaid
  quota (400 in the trial).
- **Navigation:** sidebar modules, command palette ("Create Invoice", "Go to Bills"…),
  "What's New" panel with 13 feature notes, plan upgrade banner.

Appendix A lists every module and sub-module; Appendix B lists every report.

## 4. What Hisaab Already Has (keep and protect)

| Area            | Hisaab                                                                              | Taxxa                                             |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| Offline         | Books kept in encrypted SQLite on the phone, read offline for 7 days (doc 36)       | Online only                                       |
| Book categories | GST, non-GST and mixed books per firm; lot-level book choice on sale (doc 05)       | One GST book                                      |
| Costing         | Automatic FIFO across lots, multi-lot lines, manual override, landed cost           | Weighted average, "FIFO cost lot tracking" report |
| Loans           | Loan register, schedules, reviewed interest, settlements (doc 10)                   | None                                              |
| Associates      | Delivery associates, commission accrual and payouts (doc 09)                        | Salesperson field only                            |
| Controls        | Opening approval, period locks with explicit reopening, year-end close (docs 07-08) | Transaction locking                               |
| Forecast        | Management cash forecast (doc 13)                                                   | None                                              |
| Recovery        | Firm JSON export and recovery into a new firm (doc 19)                              | "Backup support" (not seen)                       |
| Live            | WebSocket live updates, presence, instant role changes (doc 33)                     | Not seen                                          |
| Ownership       | Ownership transfer between members                                                  | Not seen                                          |
| Party rates     | Products and latest rates per party, stock left per supplier (doc 34)               | Price lists (see T24)                             |

Features both have (no work needed beyond the partial items in section 5): firms,
customers/suppliers, items with HSN and alternate units, sale, purchase, receipt, payment,
expense, journal, contra, credit/debit notes, estimates, sales orders, delivery notes,
purchase orders with partial conversion, stock adjustments, bank reconciliation (manual
ticking), GSTR-1/3B workings, composition, TDS on payments, attachments, CSV imports,
PDF printing, WhatsApp sharing and payment reminders with UPI id, party credit days and
credit limit, line discounts, multi-firm.

## 5. Gap List

Level: **Missing** = no equivalent; **Partial** = some of it exists.
Size: S (days), M (1-2 weeks), L (3-5 weeks), XL (more, or needs an outside provider).

### 5.1 Sales and purchase documents

| ID  | Taxxa feature                                                                                                                                   | Hisaab today                                                      | Level   | Size |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- | ---- |
| T01 | Proforma invoice (own numbering PI-, convert to invoice)                                                                                        | None                                                              | Missing | S    |
| T02 | Retail invoice: quick cash/walk-in bill with "Deposit to", own series RINV-                                                                     | Sale to a party only                                              | Missing | M    |
| T03 | Recurring invoices, bills and expenses (generated on a schedule)                                                                                | None (doc 01 "future scope")                                      | Missing | M    |
| T04 | Delivery challan types (supply on approval, job work, others) and optional stock deduction on the challan, with the invoice skipping it         | Delivery note order type, no challan type or stock option         | Partial | M    |
| T05 | Vendor credits, unused amount on receipts/payments, refund vouchers and refund history                                                          | Advances shown separately; no refund voucher                      | Partial | M    |
| T06 | Voucher approvals (per voucher type)                                                                                                            | None                                                              | Missing | M    |
| T07 | Custom fields on vouchers, contacts and items (type, mandatory, print) and up to 10 custom line columns with formulas like `={Quantity}*{Rate}` | Custom fields for associates only                                 | Partial | L    |
| T08 | Configurable numbering per voucher type ("Configure Invoice Number")                                                                            | Prefixes only                                                     | Partial | S    |
| T09 | Subtotal discount, discount level/type, custom charges (freight, packing), auto round-off, tax-inclusive entry                                  | Line discount and freight; no custom charges or subtotal discount | Partial | M    |
| T10 | Salesperson on sales vouchers, linked to a login; "only records created by user" role restriction                                               | Associates for delivery commission only                           | Partial | M    |
| T11 | Block new invoices for parties with overdue invoices; show last sales rate of the item                                                          | Credit days/limit stored; last rates in party rates               | Partial | S    |
| T12 | Profit margin pill on the sale form (role-gated, from weighted cost)                                                                            | Item profit view only                                             | Missing | S    |
| T13 | Multi-currency parties, exchange rates, FX gain/loss on settlement, foreign-currency PDFs                                                       | None                                                              | Missing | L    |
| T14 | Send invoices and statements by email from the firm's own mailbox (Gmail, Outlook, Zoho, Yahoo, SMTP) and by SMS                                | Share sheet and WhatsApp link only                                | Missing | M    |
| T15 | Customer/vendor portal (parties view their statement and documents)                                                                             | None                                                              | Missing | L    |
| T16 | Template designer: several templates per voucher type, account statement template, cheque template positioned in mm, image upload on invoices   | 3 fixed layouts, no logo                                          | Partial | L    |
| T17 | Digital signature certificate on PDFs                                                                                                           | None                                                              | Missing | M    |
| T18 | UPI QR code and payment link printed on the invoice                                                                                             | UPI id in reminders only                                          | Partial | S    |

### 5.2 GST and statutory

| ID  | Taxxa feature                                                                                                   | Hisaab today         | Level   | Size              |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------- | ------- | ----------------- |
| T19 | GSTIN lookup (name, address, status) and PAN/bank verification for contacts                                     | Check digit only     | Partial | M (GSP)           |
| T20 | E-invoice: IRN, ack number/date, QR, cancel; register with error details                                        | None                 | Missing | XL (GSP)          |
| T21 | E-way bill: generate and cancel, transporter, GR/RR number and date, station; register                          | None                 | Missing | XL (GSP)          |
| T22 | GSTR-2A/2B fetch (OTP) and reconciliation: exact, suggested and manual matches                                  | None                 | Missing | XL (GSP)          |
| T23 | IMS console: accept / reject / pending / no action, "apply recommended", upload to IMS                          | None                 | Missing | L (GSP)           |
| T24 | Online GSTR-1 / GSTR-3B filing with OTP; return filing status, GST ledger balance, notices                      | Book workings only   | Partial | XL (GSP)          |
| T25 | GSTR-2 (purchases) view                                                                                         | GSTR-1 and 3B only   | Missing | S                 |
| T26 | ITC at risk: bills unpaid 180+ days (reverse now) and nearing 180 (due soon); dashboard card and report         | None                 | Missing | S                 |
| T27 | Mismatch checks: IRN not generated, IRN cancelled but invoice live, e-way bill missing, value or GSTIN mismatch | None                 | Missing | M (after T20-T21) |
| T28 | TDS and TCS: receivables and payables reports, TCS on sales, TDS/TCS preference                                 | TDS on payments only | Partial | M                 |
| T29 | Editable tax rate master and tax groups (0, 3, 5, 12, 18, 28, 40 %, IGST variants)                              | Fixed set 0/5/18/40  | Partial | M                 |
| T30 | MSME preference (supplier MSME status and the 45-day payment rule)                                              | None                 | Missing | S                 |
| T31 | GSTR-1 JSON export for the offline tool (interim step before T24)                                               | None                 | Missing | S                 |

### 5.3 Inventory and manufacturing

| ID  | Taxxa feature                                                                                                                    | Hisaab today                            | Level   | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- | ---- |
| T32 | Godowns/warehouses, stock per godown, stock transfer between godowns, godown reports                                             | Single location (doc 03 "future scope") | Missing | L    |
| T33 | Serial / IMEI numbers: add or scan on purchase, pick on sale, serial-wise report                                                 | None                                    | Missing | L    |
| T34 | Barcode: generate, print labels, scan into vouchers                                                                              | None                                    | Missing | M    |
| T35 | Item variants (size, colour…)                                                                                                    | None                                    | Missing | M    |
| T36 | Price lists: sales or purchase, markup/markdown % or per-item rates, import                                                      | Party-wise latest rates (doc 34)        | Partial | M    |
| T37 | Min/max stock levels, negative-stock block and warning, low-stock alerts                                                         | Low-stock flag                          | Partial | S    |
| T38 | Expiring items and expiry timeline (batch expiry formats)                                                                        | Batch number and expiry stored on lots  | Partial | S    |
| T39 | Item categories with images; goods vs service items; "not for sale" items; item tags                                             | Item group only                         | Partial | S    |
| T40 | Bill of materials and stock journal (production: consume components, produce finished goods)                                     | None                                    | Missing | L    |
| T41 | Job work out/in: orders, material out/in vouchers, stock with party, job work outstanding report (inventory only, no accounting) | None                                    | Missing | L    |

### 5.4 Accounting and banking

| ID  | Taxxa feature                                                                                                         | Hisaab today                         | Level   | Size |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------- | ---- |
| T42 | Chart of accounts with account codes and nested groups (tree path), add group                                         | Fixed groups plus custom groups      | Partial | M    |
| T43 | Projects / cost centres on vouchers, filters on P&L/TB/GL, project summary report                                     | None (doc 01 "future scope")         | Missing | M    |
| T44 | Bulk entries (many transactions at once, with status)                                                                 | CSV import for masters and openings  | Partial | M    |
| T45 | Bank statement import and automatic matching                                                                          | Manual tick per entry                | Partial | L    |
| T46 | Cheque printing (with T16 template)                                                                                   | None                                 | Missing | S    |
| T47 | Recycle bin: restore deleted vouchers within 30 days with lines, taxes, stock and payment state; blocked on conflicts | Cancel/void with history, no restore | Missing | M    |
| T48 | Payroll: employees, earnings, payroll calendar, payroll payments                                                      | None                                 | Missing | L    |
| T49 | Invoice interest calculator (rate × days overdue)                                                                     | None                                 | Missing | S    |

### 5.5 Reports

| ID  | Taxxa feature                                                                    | Hisaab today              | Level   | Size        |
| --- | -------------------------------------------------------------------------------- | ------------------------- | ------- | ----------- |
| T50 | 80 reports (Appendix B); about 33 are missing in Hisaab and about 20 are partial | 21 + screens              | Partial | L (batched) |
| T51 | T-format P&L and balance sheet                                                   | Vertical only             | Missing | S           |
| T52 | Cash flow statement (indirect, operating/investing/financing)                    | Cash and bank movement    | Partial | M           |
| T53 | Custom report builder; per-user column preferences                               | None                      | Missing | L           |
| T54 | Excel and JSON export of every report; print and PDF from every report           | PDF and CSV downloads     | Partial | S           |
| T55 | Audit trail report with user, action and IP address                              | Firm audit history screen | Partial | S           |
| T56 | Customer tracking (new / regular / lost), most valuable customers and vendors    | None                      | Missing | S           |

### 5.6 Users, security and personalisation

| ID  | Taxxa feature                                                                                                                                                                                                          | Hisaab today                              | Level   | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- | ---- |
| T57 | Custom roles with per-sub-module permissions (about 85 sub-modules) and extra rights: hide purchase rate, view profit margin, only own records                                                                         | 4 fixed roles × 8 permissions             | Partial | L    |
| T58 | Two-factor authentication per user                                                                                                                                                                                     | Email OTP for verification and reset only | Missing | M    |
| T59 | Branding: organisation brand colour, sidebar theme, logo on documents                                                                                                                                                  | No logo or brand colour                   | Partial | S    |
| T60 | Module rename and reorder (show "Estimate" as "Quotation")                                                                                                                                                             | None                                      | Missing | S    |
| T61 | Business profile: ownership type, PAN, CIN, TAN, FSSAI, MSME, business and industry type, fiscal year start                                                                                                            | Firm GSTIN/state/basic details            | Partial | S    |
| T62 | Contact search settings (by name, phone, GSTIN)                                                                                                                                                                        | Name search                               | Partial | S    |
| T63 | Dashboard: average days to get paid / to pay, today's profit, sales projection, customer tracker, best sellers, slow movers, expiring items, GST summary, ITC at risk, top receivables/payables, user-arranged widgets | Dashboard with sales, dues and cash       | Partial | M    |

### 5.7 Integrations and automation

| ID  | Taxxa feature                                                                                            | Hisaab today                                | Level   | Size |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------- | ---- |
| T64 | Scheduled reminders (name, schedule, status) with send logs, by email/SMS/WhatsApp                       | Reminder preparation; WhatsApp sent by hand | Partial | M    |
| T65 | Public API keys (role-scoped) and webhooks                                                               | None                                        | Missing | M    |
| T66 | Tally integration (ledger sync / export)                                                                 | None                                        | Missing | L    |
| T67 | Shopify integration                                                                                      | None                                        | Missing | L    |
| T68 | Excel import of transactions with an import log (total, success, failed, skipped) and assisted migration | CSV masters/openings with validation        | Partial | M    |

### 5.8 Growth modules

| ID  | Taxxa feature                                                                                                      | Hisaab today        | Level   | Size |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------- | ------- | ---- |
| T69 | AI OCR: upload bill or expense images, extract and create the voucher, with upload status                          | Attachments only    | Missing | L    |
| T70 | Online store: public storefront, catalogue, online orders into the app, store dashboard                            | None                | Missing | XL   |
| T71 | Branches / linked organisations: inter-branch transfers, stock requests, master sync, branch reports               | Separate firms only | Missing | XL   |
| T72 | Studio: festival greeting posts with the firm's details (download, share)                                          | None                | Missing | M    |
| T73 | Custom domain (white-label app and login)                                                                          | None                | Missing | M    |
| T74 | Subscriptions and plan limits (Razorpay), prepaid SMS / e-way / e-invoice credits, "What's New" panel, in-app chat | None                | Missing | L    |

## 6. Decisions Needed From the Owner

### Decided 16 Nov 2026

- **GST stays reports-only.** Hisaab shows and downloads GST reports built from the
  data in the books. No GST portal connection and no GSP provider. Dropped: T19
  (GSTIN lookup), T20 (e-invoice), T21 (e-way bill), T22 (2A/2B fetch), T23 (IMS),
  T24 (online filing) and T27 (portal mismatch checks). Phase 5 is cancelled.
- **No large modules.** Dropped: T48 (payroll), T67 (Shopify), T70 (online store),
  T71 (branches).
- **No paid plans.** Dropped: T74 (subscriptions, credit packs, plan gating).
- **Tax scope widened.** Add TDS receivable on receipts, TCS on sales, TDS/TCS
  receivable and payable reports, and an editable tax-rate list (T28, T29). This
  replaces the 2 Nov 2026 exclusion. Still reports and book entries only.
- **GSTR-1 JSON download** (T31) is wanted: a file built from our own report, uploaded
  by the user if they choose.
- **Sending:** email from each firm's own mailbox (Gmail, Outlook, Zoho or SMTP) for
  documents and scheduled reminders. WhatsApp stays a one-tap share. No SMS (T14, T64).
- **Retail invoice** (T02) is online only; the offline design does not change.
- **Extras wanted later:** AI bill scanning (T69; provider still to choose), festival
  posts (T72) and the iPhone app. **Not wanted:** API keys and webhooks (T65). Custom
  domain (T73) was not chosen and is treated as out of scope.
- Remaining work starts with Phase 0, on branch `phase6/foundations` (from
  `phase5/access-control`).

### Phase 0 choices (16 Nov 2026)

| Step                     | Decision                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles (T57)              | Editable roles from a screen-by-screen matrix (view / create / edit / cancel) plus extra rights: hide purchase rate, view profit margin, only own records. The four current roles become ready-made starting roles. |
| Cancel and restore (T47) | Keep cancel-only. Add a cancelled-vouchers list where the owner can restore a voucher, refused when the period is locked or its stock was used since. No real delete.                                               |
| Custom fields (T07)      | Parties, items and voucher headers, with an option to print on the PDF. No line columns or formulas.                                                                                                                |
| Numbering (T08)          | Per voucher type: prefix, starting number, number of digits, and whether the year part is shown. Still restarts each financial year. Existing numbers never change.                                                 |
| Documents (T16/T59)      | Firm logo and signatory signature/stamp image on every PDF. No extra templates, brand colour or module rename for now.                                                                                              |
| Audit (T55)              | Record IP address and device with every change; visible to the owner (and roles given the audit right); in the audit report and export.                                                                             |

### Phase 0 progress

| Step                         | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbering (T08)              | **Built.** `invoice_settings.numbering` (migration 0031) holds `{ start, digits, showYear }` per type; `numberingRule`, `formatVoucherNumber` and `nextSequence` in `packages/core/src/books/base.ts` are used by saves and by the API's next-number preview. With the year hidden a type keeps one running sequence (counter year `all`), because numbers are unique per firm and type (`vouchers_firm_type_number_idx`); a yearly restart would repeat them. Firm export format is now **version 5**; version 2-4 files upgrade with default numbering, and restore accepts `PREFIX/0001` numbers. Settings → Invoice and numbering: tap a type to set start, digits and year. Tests: `packages/core/tests/voucher-numbering.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audit IP and device (T55)    | **Built.** `audit_log.ip_address` and `device` (migration 0032). A per-request store (`packages/backend/src/lib/request-origin.ts`) is opened for every API request with `req.ip` (honours `TRUSTED_PROXY_CIDRS`); authentication adds the session's device ("Owner Phone (App)", "Web browser"). `saveChanges` writes both on every edit-log row, so every route that saves vouchers is covered. Only roles with the `team` right (the owner) receive them from `/v1/audit-log` and `/v1/audit-log/page`; custom roles will move this to an audit right. Included in the firm export (v5; older files restore with nulls). The Edit log screen shows them under each entry. A downloadable audit report comes with the Phase 1 reports pack (T54/T55). Tests: `apps/api/tests/audit-origin.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Cancel and restore (T47)     | **Built.** Vouchers are still never deleted. `restoreBlocker` / `restoreVoucher` in `packages/core/src/books/corrections.ts` put a cancelled voucher back as it was, keeping its number, and refuse when: a later stock correction touches its items; its stock lots were used since; a purchase's supplier invoice number was reused; a bill it settles was cancelled or settled by others since (or it settles opening balances); a return's bill was cancelled or returned again; or the order it was wholly made from was converted into another entry or cancelled (that order is marked converted again on restore). Partial order conversions are re-checked against the order's remaining quantities, and the period lock, associate commission and delivery hooks run as for any save. New edit-log action `restored` (migration 0033). Owner only (team right) until roles add a restore right: `GET /v1/vouchers/cancelled` lists entries with the reason a restore would be refused, `POST /v1/vouchers/:id/restore` (If-Match). App: Settings → Cancelled entries. Tests: `packages/core/tests/restore-cancelled.test.ts`, `apps/api/tests/restore-cancelled.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                        |
| Custom fields (T07)          | **Built.** Definitions in `custom_fields` (migration 0034): parties, items or bill/order headers; text, number, date, yes/no or choice; required, switched on/off, print, and which voucher types (sale, purchase, estimate, sales order, delivery note, purchase order). Values are jsonb on the rows keyed by the field's permanent key (`cf_…`), so restore needs no remapping and each bill's frozen snapshot keeps the party's and items' values as issued. Rules in `packages/core/src/customFields.ts`: unknown keys and bad values refused; required fields enforced when a form sends values (order conversions, split sales and imports are not blocked); an edit that sends no values keeps them. API: `/v1/settings/custom-fields` (all members read; settings right to change; type, record and existing choices fixed; up to 20 per record). App: Settings → Custom fields; inputs on the party, item, bill and order forms; values on the detail screens. Definitions are not in the sync change log, so another device sees a new field when it next loads the list. Firm export v5 carries both. Tests: `packages/core/tests/custom-fields.test.ts`, `apps/api/tests/custom-fields.test.ts`. Fields marked "print" go on bill and order PDFs (in-app and server): header fields with the bill details, party fields under the party, item fields under each item name; labels are today's names, values are the ones frozen when the bill was issued.                                                                                                     |
| Logo and signature (T16/T59) | **Built.** `firm_branding` (migration 0035) holds the logo and the signatory’s signature or stamp as PNG/JPEG data URIs (about 150 KB each), apart from `invoice_settings` so the images are not copied into every voucher’s frozen snapshot. `GET/PUT /v1/settings/branding` (all members read; settings right to change; If-Match). Printed by the shared `voucherHtml` (in-app and server PDF): logo above the firm name, signature above “Authorised signatory”; only PNG/JPEG data URIs reach the page. App: Settings → Invoice and numbering → Logo and signature (picked images are shrunk on the phone). Firm export v5 carries them. Tests: `packages/core/tests/custom-fields.test.ts`, `apps/api/tests/custom-fields.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Roles (T57)                  | **Built.** `packages/core/src/roles.ts`: the four built-in roles are fixed presets that match the old behaviour exactly (tested right by right); custom roles (`r_<uuid>`, table `custom_roles`, migration 0036) grant areas (the 8 module rights), See/Add/Edit/Cancel per voucher type, and extra rights: hide purchase rates, see profit margin, only entries they made, see where changes came from (audit IP/device), restore cancelled entries. A role not known to the registry has no rights. The API and realtime hub read the member’s custom role from that firm on every request; saves check the action they perform (new = add, newly cancelled = cancel, otherwise edit), reads check See, and “only entries they made” limits edits, cancels, detail reads, list pages, the paged list and search. Hard-coded role lists now ask for the right that matched them; owner-only actions (backup, book controls, year end, ownership, approvals) stay owner-only. `/v1/firms/current/roles` (all read; team right to change; edits notify the role’s members so new rights apply at once; roles in use can’t be deleted). Members are moved to custom roles directly (Better Auth knows only the built-ins); invitations use a built-in role. Each user’s firm list carries their custom role, so the app knows its rights offline. App: Settings → Roles (copy a built-in, matrix editor), custom roles in the team picker, separate Edit/Cancel/Return buttons per right. Tests: `packages/core/tests/roles.test.ts`, `apps/api/tests/custom-roles.test.ts`. |

### Phase 1 progress

| Step                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reports pack 1 and Excel (T50, T51, T54, T25) with the ITC, interest and customer reports (T26, T49, T56) | **Built.** 18 new reports in the existing registry (`packages/core/src/reporting/insights.ts`), built from the same books snapshot as the others, so firm isolation, the tax scope and cost blanking apply unchanged. **Statements:** Trading and Profit & Loss and Balance Sheet in T format (Dr/Cr sides). **GST:** GSTR-2 view from Hisaab's own purchases (B2B with GST including expenses, debit notes, purchases without GST); tax summary by rate. **ITC at risk:** supplier bills with GST still unpaid, the ITC share still unpaid (tax × pending ÷ bill amount) and the days left to the 180-day limit; bills from day 150 are flagged. **Interest calculator:** pending × rate × overdue days ÷ 36,500 per overdue bill; the rate is chosen on the screen (default 18%, 0-60%) and refused on any other report. **Customers and suppliers:** customer tracking (last sale, days since, quiet for 90+ days), top customers and top suppliers, sales and purchases by party, sales and purchases by item (base unit, returns netted), expenses by supplier. **Orders:** registers of estimates, sales orders, delivery notes and purchase orders with their status. Customer, vendor, payment and account-transaction views already existed (receivables, payables, receipts, payments, general ledger). **Excel:** every report downloads as .xlsx (`packages/core/src/reporting/xlsx.ts`, no library): money is numbers in rupees with a `#,##0.00` format so Excel totals work, and text is always text, never a formula. Built on the phone/browser like the PDF and CSV, so no worker job is needed. App: Settings → Reports (format PDF / Excel / CSV; party picker shows only customers or suppliers as the report needs). Tests: `packages/core/tests/phase1-reports.test.ts`, `apps/api/tests/reports-export.test.ts` (every report through the API). The ITC dashboard card comes with the dashboard widgets step.                                                                      |
| Credit control and last rate (T11)                                                                        | **Built.** Firm setting in `sales_controls` (migration 0038): what overdue bills do to a new sale, **Allow** (not shown), **Warn** (default, the old behaviour: the sale form shows the overdue amount) or **Block**. With Block, a new sale (normal, split, or made from an order) to a customer with overdue bills needs the owner's approval for that exact sale, through the same approval as a sale above the credit limit (single use, 15 minutes, tied to the sale, the customer's version and balance); edits of existing sales are not blocked for overdue bills. Rules in `packages/core/src/accounting/creditControl.ts`: a bill is overdue once its credit days have passed; money on account counts against the oldest bills first; the sales being saved never count against themselves (a back-dated sale). Refusal code `OVERDUE_BILLS` (the limit keeps `CREDIT_LIMIT_EXCEEDED`). `GET/PUT /v1/settings/sales-controls` (all members read, offline too; settings right to change; If-Match). Firm export v5 carries it (optional; older files restore with the default). App: Settings → Credit control; the sale form and order fulfilment ask for an "Owner approval reason". **Last rate:** each line on sale, purchase and order forms shows the rate on this party's latest bill for the item ("Last sold at ₹99.00 / Nos on 30-08-2026 · SI/26-27/0012") with a **Use** button; supplier rates only for roles that may see costs. Tests: `packages/core/tests/credit-control.test.ts`, `apps/api/tests/credit-control.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Proforma invoice (T01)                                                                                    | **Built.** New order type `proforma` (migration 0037 adds it to `voucher_type`): a priced document for a customer that never posts, own series `PF/…` (numbering settings apply), printed as "PROFORMA INVOICE" with "This is not a tax invoice", bank details and terms. Conversions: estimate → proforma, proforma → sale only, through order fulfilment, so part quantities work and the proforma shows open / partly converted / converted. No validity date (estimates keep theirs). Built-in sales roles get it like estimates; a custom role gets no proforma rights until the owner ticks them in its matrix. Everywhere order types are listed: sync drafts, offline queue, attachments, custom fields (voucher headers), daybook filter, numbering screen, the New menu ("Proforma Invoice"), the Orders screen tab and a "Proforma invoices" register report. Tests: `packages/core/tests/proforma.test.ts`, `apps/api/tests/proforma.test.ts` (estimate → part proforma → sale through the API, customer balance unchanged until the sale).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dashboard widgets (T63) with the ITC at risk card (T26)                                                   | **Built.** Still one Home request: `GET /v1/reports/dashboard` (and the demo/offline `reportService.dashboard`) now also returns **ITC at risk** (regular GST firms only, else null: ITC share still unpaid on supplier bills from day 150, the part already past 180 days, the next 180-day date and the supplier with most at risk), **top customers / top suppliers this month** (top 3, returns netted), **receivables by age** (equals the Receivables report), **payables due** (this week and overdue), **customers gone quiet** (no sale in 90 days, the customer tracking report's "Lost") and **open estimates, proformas and orders** by type. The card figures and the reports share the same rules (`packages/core/src/accounting/insightRules.ts`, used by `insights.ts` too), so a card always matches the report it opens. **Stock value** is 0 from the server for roles without cost rights (`canSeeCosts`; e.g. a custom role with purchase rates hidden), and the card is not offered to them; the phone's offline copy does the same. Same right as before (`reports`). **Cards:** 21 cards (`packages/core/src/dashboardLayout.ts`: id, title, half/wide, default on/off, cost or sales rights); new ones off by default: payables due, receivables by age, top suppliers, customers gone quiet. ITC card opens the report (Settings → Reports now takes `?report=`); its Pay link opens a payment to that supplier (purchase right). **Customise dashboard** (Home button and Settings): tick to show/hide, arrows to reorder, back to default; kept per user on the device (`hisaab.dashboard.<user>` in the app's key store) and merged with the card list, so a card added later (e.g. expiring stock with lot expiry, meant to sit after Low stock) appears in its default place. Demo seed gains one part-paid 158-day bill (Shiv Electricals) so the ITC card shows a figure. Tests: `packages/core/tests/dashboard-cards.test.ts`, `apps/api/tests/dashboard-cards.test.ts`. |

The items below are the original list; all are now settled above.

1. **Earlier "not wanted" items.** On 2 Nov 2026 the owner excluded TDS receivable on
   receipts, special rates, exports/SEZ and reverse charge (doc 32). Taxxa has TDS
   receivables and TCS (T28) and a wider tax master (T29). Confirm that full parity
   now overrides those decisions.
2. **GSP provider for statutory GST (T19-T24, T27).** E-invoice, e-way bill, 2A/2B,
   IMS and filing all need a licensed GSP/ASP API with sandbox credentials and per-call
   fees. Choose the provider and who pays for credits.
3. **Offline rule.** The phone is read-only offline (docs 33, 36). Retail billing (T02)
   at a counter usually needs offline sale entry. Keep online-only, or approve an
   offline sale queue as a separate design.
4. **Paid plans (T74).** Is Hisaab going to sell plans, or stay a private tool? This
   decides whether to build plan gating, Razorpay billing and credit packs.
5. **SMS and email senders (T14, T64).** Choose an SMS gateway with DLT registration,
   and whether email goes from each firm's mailbox (OAuth/SMTP) or a shared domain.
6. **Scope of XL modules.** Online store (T70), branches (T71), Shopify (T67) and
   payroll (T48, statutory PF/ESI later?) are large products. Confirm they are wanted
   now or after phases 1-5.
7. **AI provider for OCR (T69)** and where scanned images may be processed.

## 7. Step-by-Step Plan

Every new feature must follow the existing engineering rules (doc 03, doc 22):

- Integer paise, `YYYY-MM-DD` dates, balanced postings, firm isolation, period locks,
  idempotent mutations and version checks.
- A reviewed migration, run after a verified backup.
- The new data added to: the firm export and restore validation (doc 19), the phone
  replica and `change_log` (doc 36), `OFFLINE_READABLE_PATH`, live notices (doc 33),
  role checks in `app.inFirm(...)`, and cost blanking for sales roles.
- Tests in `packages/core/tests` and `apps/api/tests`, and a guide update.

Each step below lists: data model → core → API → app → reports/print → tests → docs.

### Phase 0. Foundations (do first; later phases depend on them)

1. **Granular roles (T57).**
   - Model: `role` table (firm, name, description) and `role_permission` rows (sub-module, view/create/edit/delete, plus flags: hide purchase rate, view profit margin, own records only). Seed the current four roles as built-ins.
   - Core: move `packages/core/src/permissions.ts` from 8 permissions to sub-module rights; keep `canDo(role, permission)` working for old checks.
   - API: `app.inFirm()` takes a sub-module right; read filtering and `costPayloadForRead` use the new flags; add `created_by` on vouchers and parties for "own records".
   - App: Settings → Team → Roles editor (matrix screen); salesperson link to a login.
   - Tests: every route's right; role change still closes sockets (doc 33).
2. **Custom fields and columns (T07).**
   - Model: `custom_field` definitions (entity, type, mandatory, print) and JSON values on voucher, line, party and item.
   - Core: formula columns, parsed safely: only field references and + − × ÷, no code execution.
   - Print: optional column and footer total.
   - Export/replica: include values.
3. **Numbering and module settings (T08, T60).** A per-voucher-type series (prefix, next number, reset per FY) and display names, stored in firm settings. Display only; no data renaming.
4. **Template engine (T16, T59).** Template records per voucher type (layout, colours, logo, fields shown, terms), rendered by `packages/core/src/print/voucherHtml.ts` and the worker PDF. Add a logo upload (private R2, doc 16). Cheque and statement templates come in Phase 3.
5. **Soft delete and recycle bin (T47).** Deleted vouchers move to a recycle state with a 30-day expiry job (worker). Restore re-posts lines, taxes, stock lots and allocations through the normal posting path, and is refused when the number is reused, the period is locked, or the stock lots have been consumed since.
6. **Audit trail detail (T55).** Record the user, action, IP and device on every mutation (the session already holds them), and show them in the audit report with filters and export.

### Phase 1. Quick wins on existing data (no outside provider)

7. **ITC at risk (T26):** from purchases with GST, unpaid amount and bill date + 180 days; dashboard card and report; link to payment entry. Uses current allocations, no migration.
8. **Interest calculator (T49), payment reminder list, customer tracking, most valuable customers/vendors (T56):** read-only reports over existing vouchers.
9. **Proforma invoice (T01):** new order type `proforma`, its own series, print, convert to sale through order fulfillment (doc 11).
10. **Credit control and last rate (T11):** a firm setting to block (or warn on) a sale when the party has overdue invoices or exceeds its credit limit; last sale rate shown on the line (doc 34 data).
11. **Profit margin on the sale form (T12):** per line and total from FIFO cost, shown only with the "view profit margin" right; never for sales roles (doc 33 R1).
12. **Discounts and charges (T09):** subtotal discount, custom charge heads with GST treatment, round-off account, tax-inclusive rate entry. Update `invoiceTotals`, postings, GSTR-1 taxable value and print.
13. **Stock levels and expiry (T37, T38):** min/max per item, negative-stock policy (block/warn), expiring-items report and dashboard timeline from lot expiry.
14. **Item master extras (T39):** service items (SAC, no stock), not-for-sale flag, categories with image, tags.
15. **Reports pack 1 (T50, T51, T54):** T-format P&L/BS; sales and purchase by party and by item; expense by account and by vendor; customer and vendor balances; document detail reports (estimates, orders, delivery notes, credit/debit notes); payments method-wise; GSTR-2 view (T25); tax summary; account transactions; Excel export for all reports (CSV exists; add XLSX writer in the worker).
16. **Business profile and MSME (T61, T30):** extra statutory fields, MSME supplier flag, 45-day overdue report for MSME payables.
17. **Dashboard widgets (T63):** add the missing cards from existing report builders; per-user order and visibility stored on the device first, server later.
18. **Two-factor authentication (T58):** TOTP via Better Auth's two-factor plugin; enforce per user; recovery codes; owner can require it for the firm.
19. **GSTR-1 JSON (T31):** export in the GST portal offline-tool format from the existing `Gstr1` working.

### Phase 2. Documents and selling

20. **Retail invoice (T02):** walk-in sale with a cash/UPI deposit account, short form, separate series, thermal print layout (58/80 mm). Online-only unless decision 3 changes.
21. **Recurring vouchers (T03):** a schedule (frequency, start, end, next date) on a template voucher; a worker job creates drafts or posts them; skips locked periods; notifies the owner.
22. **Delivery challan types and stock (T04):** challan type field; firm setting (one-way, as in Taxxa) to move stock on the challan; invoice from a posted challan skips stock; cancel returns stock.
23. **Refunds and vendor credits (T05):** refund voucher against a receipt or payment advance; vendor credit from debit notes applied to later bills; refund history reports.
24. **Salesperson (T10):** salesperson master linked to a user; sales by salesperson and sales orders by salesperson reports; "own records only" uses `created_by` and salesperson.
25. **Price lists (T36):** sales/purchase lists with % markup/markdown or per-item rates, assignable to parties, applied on the line before party rates; import from CSV.
26. **Approvals (T06):** per voucher type, draft → submitted → approved; approved-only posting; approver right in roles.
27. **UPI QR on invoices (T18):** UPI deep-link QR with amount and invoice number in the print template.
28. **Item variants (T35):** variant attributes generating child items that share a parent for reports.

### Phase 3. Inventory, manufacturing and accounting depth

29. **Godowns (T32):** `location` table; every stock movement and lot gets a location; transfer voucher (out/in, in-transit); per-godown stock, valuation and reorder levels; godown reports. Migrate existing lots to a default godown.
30. **Serial / IMEI (T33):** serial table linked to lot and item; entry/scan on purchase; pick on sale and returns; uniqueness per firm; serial-wise report.
31. **Barcode (T34):** item barcode field and generator (EAN-13/Code-128), label print sheet, scan with the camera in vouchers (expo-camera).
32. **Bill of materials and stock journal (T40):** BOM with component quantities and wastage; production voucher consuming components (FIFO cost) and creating a finished lot at rolled-up cost.
33. **Job work (T41):** job work orders (out and in), material out/in vouchers, stock-with-party balances, outstanding report; inventory only, no postings.
34. **Cost centres (T43):** project/cost-centre master; optional tag on voucher and line; filters on P&L, TB, GL and registers; project summary report.
35. **Chart of accounts depth (T42):** account codes and nested custom groups under the fixed primary groups; reports roll up by tree.
36. **Bulk entries and transaction import (T44, T68):** spreadsheet-style multi-row entry and Excel/CSV import of sales, purchases, receipts, payments and journals, using the same validation as single entries; import log with per-row result.
37. **Bank statement import (T45):** CSV/XLSX/PDF-to-rows import per bank account; auto-match on amount, date window and reference; suggested and manual matches; unmatched lines become receipt/payment drafts.
38. **Cheques and statement templates (T46, T16):** cheque template in mm per bank, print from payment; account statement template.
39. **Multi-currency (T13):** currency per party (locked after first voucher); rate per voucher (manual, or fetched for major currencies); base-currency postings; FX gain/loss account on settlement; dual-currency party statement; PDF in foreign currency.
40. **TDS/TCS complete (T28, T29):** TDS receivable on receipts, TCS on sales, TDS/TCS preference and sections; receivable/payable reports; editable tax rate master and tax groups.
41. **Cash flow statement and reports pack 2 (T52, T50):** indirect cash flow; inventory valuation, batch-wise, contact-wise and group/category-wise stock, in/out group detail, highest selling, slow moving, negative stock, min/max register, stock journal summary.
42. **Payroll (T48):** employee master, earnings and deductions, monthly calendar, payroll run posting salary expense/payable, payroll payments, payslips. Statutory PF/ESI/PT is a later decision.

### Phase 4. Communication and integrations

43. **Email sending (T14):** per-firm mailbox via OAuth (Gmail, Microsoft) or SMTP; encrypted credentials; worker sends PDFs with retry and a send log.
44. **SMS (T14):** DLT-registered templates through the chosen gateway; prepaid counter per firm.
45. **Scheduled reminders (T64):** reminder rules (before/after due date, repeat), channels (email, SMS, WhatsApp link), logs; reuse the existing worker reminder preparation.
46. **Customer/vendor portal (T15):** signed, expiring links per party showing statement, open invoices, PDFs and UPI pay; no login needed for parties.
47. **Digital signature (T17):** upload a DSC (PFX) to secure storage; sign PDFs in the worker (PAdES); certificate list with expiry.
48. **API keys and webhooks (T65):** keys scoped to a role; HMAC-signed webhooks on voucher and party events, with retries and delivery logs. Login, users, roles, keys and billing are never exposed.
49. **Tally export (T66):** masters and vouchers as Tally XML; later two-way sync if wanted.
50. **Shopify (T67):** import orders as sales orders, sync stock and prices (after godowns).

### Phase 5. Statutory GST through a GSP (after decision 2)

51. **GSP client and credentials:** firm GST login (username, OTP session) stored encrypted; provider adapter interface so the GSP can be changed; sandbox first.
52. **GSTIN lookup (T19):** fill party name, address, state and status from GSTIN; periodic status check.
53. **E-invoice (T20):** build the IRP JSON from the frozen voucher snapshot; generate IRN, store ack number/date and signed QR; print QR and IRN; cancel within 24 hours; register with error details.
54. **E-way bill (T21):** generate from the invoice or challan with transporter, vehicle, distance, GR/RR; cancel; extend validity; register.
55. **GSTR-2A/2B fetch and reconciliation (T22):** fetch per period (OTP); match purchases (exact / suggested / manual); actions to accept, edit or add missing bills.
56. **IMS (T23):** inbox of supplier invoices with accept/reject/pending, recommended actions from reconciliation, upload actions.
57. **Return filing (T24):** push GSTR-1 data, file with OTP/EVC, show filing status, GST ledger balance and notices; GSTR-3B from the existing working after reconciliation.
58. **Mismatch checks (T27):** daily job listing IRN missing or cancelled, e-way bill missing, value and GSTIN mismatches.

### Phase 6. Growth modules (after decision 6)

59. **AI OCR (T69):** upload bill/expense image or PDF → extracted draft (party, GSTIN, items, taxes) → user review → post; upload status counts.
60. **Studio (T72):** festival post templates with the firm's name, phone, email, website and address; download and share.
61. **Online store (T70):** public catalogue per firm, item selection, order intake as sales orders, store settings and dashboard.
62. **Branches (T71):** linked firms with shared masters, inter-branch transfer vouchers, stock requests, sync log and branch reports.
63. **Custom domain (T73)** and **subscriptions / What's New / support chat (T74)**, per decision 4.
64. **iOS release:** build and publish the Expo app for iPhone (Taxxa has an iOS app).

### Order and acceptance

| Phase | Depends on                            | Acceptance (in addition to tests)                                                          |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0     | —                                     | Existing four roles behave exactly as today; restore of an old export still works          |
| 1     | 0 (roles for margin)                  | Trial balance still balances; GSTR-1/3B unchanged on old data                              |
| 2     | 0                                     | Converted, recurring and refunded vouchers appear in reports, export and the phone replica |
| 3     | 0, godowns before serials and Shopify | Stock per godown sums to item stock; FIFO cost unchanged for single-godown firms           |
| 4     | 0 (keys), 2 (reminders)               | No credential appears in logs, exports or the phone copy                                   |
| 5     | Decision 2                            | Sandbox IRN, e-way bill and 2B fetch succeed; cancelled IRN blocks invoice edit            |
| 6     | Decision 6                            | Per module                                                                                 |

## 8. Appendix A: Taxxa Modules and Sub-modules

From the app's permission map and sidebar (bundle and walkthrough):

| Module        | Sub-modules (route)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | Dashboard (`/dashboard`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Contact       | Customers, Vendors, Both (`/contacts?type=…`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Inventory     | Items, Godowns, Price List, Groups, Categories, Stock Adjustment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Manufacturing | Stock Journal, Bill of Material, Job Work, Stock Transfer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Branches      | Transfers, Stock Requests, Master Sync, Branch Reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Banking       | Bank Accounts, Receipts, Payments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sales         | Estimate, Sales Order, Delivery Challan, Proforma Invoice, Invoice, Retail Invoice, Credit Note, Payment Received; Recurring Invoice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Purchase      | Purchase Order, Bills, Debit Notes, Expense, Payment Made; Recurring Bill, Recurring Expense; Vendor Credits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Payroll       | Employees, Payroll Payments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Accountant    | Journals, Chart of Accounts, Opening Balances, Bulk Entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GST           | GST Dashboard, E-Way Bill, E-Invoice, 2B Reconciliation (2A/2B), IMS, GSTR-1/2/3B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Online Store  | Store Dashboard, Orders, Catalog, Settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AI            | OCR uploads (bills, expenses)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Documents     | Folders and files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Reports       | Appendix B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Studio        | Festival posts (49 templates across 7 festivals)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Settings      | Business Profile, Tax Preference (GST, tax rates, TDS/TCS), Users & Roles (2FA), General (rates, payment type, round-off, salesperson, overdue block, last rate, decimals, multi-currency, discounts, custom charges), Module (rename/reorder), Payroll, Transaction Locking, Contact Preference (custom fields, search, portal), Inventory Preference (inventory, godown, negative stock, min/max, low stock, custom fields, barcode, job work, challan inventory), Sales/Purchase Preference (per voucher terms, custom fields, custom columns, approvals, profit margin), Projects/Cost Centres, Online Store, Template Preference (12 document types incl. cheque and account statement), Branding, Reminders (+ logs), Custom Domain, Digital Signature, Import (+ log), Integration (email, Tally), Developers (API keys, webhooks), Recycle Bin, Subscriptions |

## 9. Appendix B: Taxxa Reports and Hisaab Equivalents

Have = Hisaab has an equivalent; Part = partly; — = missing.

| Group                | Report                                                                                 | Hisaab                                         |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Business overview    | Profit and Loss (T format)                                                             | —                                              |
|                      | Balance Sheet (T format)                                                               | —                                              |
|                      | Cash Flow Statement                                                                    | Part (cash and bank movement)                  |
|                      | Profit and Loss                                                                        | Have                                           |
|                      | Balance Sheet                                                                          | Have                                           |
|                      | Project / Cost Center Summary                                                          | —                                              |
| Inventory            | Inventory Summary                                                                      | Have (stock summary)                           |
|                      | Sr. No. wise Items                                                                     | —                                              |
|                      | Inventory Valuation Summary                                                            | Part (stock value)                             |
|                      | Godown Summary; Item Wise Godown Details                                               | —                                              |
|                      | Batch Wise Summary                                                                     | Part (lots)                                    |
|                      | Average Cost Lot Tracking                                                              | Part (FIFO lots)                               |
|                      | Inventory Negative Stock                                                               | —                                              |
|                      | Expiring Items                                                                         | —                                              |
|                      | Minimum & Maximum Stock Register                                                       | —                                              |
|                      | Highest Selling Items; Profitable Items; Slow Moving Items                             | Part (item profit view)                        |
|                      | Low Stock Items                                                                        | Part (filter)                                  |
|                      | In/Out Group-wise Detail; Categorywise Summary; Groupwise Summary; Contactwise Summary | —                                              |
|                      | Stock Journal Summary                                                                  | —                                              |
| Sales                | Sales Register                                                                         | Have                                           |
|                      | Sales by Customer; Sales by Item                                                       | Part (trade summary)                           |
|                      | Sales by Sales Person; Sales Order by Sales Person                                     | —                                              |
|                      | Customer Tracking                                                                      | —                                              |
| Receivables          | Customer Balances; AR Summary (due invoices)                                           | Have (outstanding)                             |
|                      | Aging Summary; Aging Details                                                           | Have (receivables ageing)                      |
|                      | Invoice / Estimate / Credit Note / Sales Order / Delivery Challan / Proforma Details   | Part (registers for invoices and credit notes) |
|                      | Payment Received                                                                       | Have (receipt register)                        |
|                      | Refund History                                                                         | —                                              |
|                      | Most Valuable Customers                                                                | —                                              |
|                      | Invoice Payments (method-wise)                                                         | —                                              |
|                      | Invoice Payments Reminder                                                              | Part (reminders screen)                        |
|                      | Invoice Interest Calculator                                                            | —                                              |
| Purchases & expenses | Purchase Register                                                                      | Have                                           |
|                      | Purchases by Vendor; Purchases by Item                                                 | Part (trade summary)                           |
|                      | Purchase Order Details; Purchase Order by Vendor                                       | —                                              |
|                      | Expense Register; Expenses by Account                                                  | Have (expense summary)                         |
|                      | Expenses by Vendor / Category                                                          | —                                              |
| Payables             | Vendor Balances; AP Summary (due bills)                                                | Have                                           |
|                      | Aging Summary; Aging Details                                                           | Have (payables ageing)                         |
|                      | ITC at Risk (180 days)                                                                 | —                                              |
|                      | Bills Details; Debit Note Details; Payment Made                                        | Have (registers)                               |
|                      | Refund History; Most Valuable Vendors; Bill Payments (method-wise)                     | —                                              |
| Accountant           | Account Transactions                                                                   | Part (general ledger)                          |
|                      | General Ledger; Journal Report; Trial Balance; Day Book                                | Have                                           |
|                      | Tax Summary                                                                            | Part (tax ledgers)                             |
|                      | Audit Trail Report                                                                     | Part (audit screen)                            |
| Bank                 | Bank Summary; Receipt Transactions; Payment Transactions                               | Have (bank book, registers)                    |
| TDS/TCS              | TDS Receivables; TDS Payables; TCS Receivables; TCS Payables                           | —                                              |
| Custom               | Custom report builder; "request a custom report"                                       | —                                              |

## 10. Appendix C: Evidence

- REA `analyze_web_bundle`: 35 scripts parsed, 356,087 AST nodes; one script hit the
  30 s per-script limit (its findings are unknown). Route view: 15 static candidates.
  Retained Evidence `ev_50b2bcc3dd10a1c88942bef653bbacd87a46c11393beabf17a81b93ce7f20882`.
- String extraction from the same chunks: 82 route paths, the module/permission map
  (15 modules), plan feature keys and labels, 13 "What's New" notes.
- Walkthrough: 214 pages, 0 errors, 186 distinct API endpoints (GET), plus the add forms
  for item, contact, employee, price list, project and role, and nine settings pages.
- Static findings and empty-account screens do not show calculation rules. Confirm
  behaviour with sample data in a Taxxa trial before copying a rule exactly.

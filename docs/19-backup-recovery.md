# 19. Firm Export and Recovery

[Documentation index](README.md)

Bounded export, inspection and owner-confirmed recovery create a **new firm**.
Version 4 retains stock corrections, settlements, opening bills/import provenance, partial
order fulfillment and associate accounting in addition to version 3's monetary
opening allocations, loans and import receipts. Full database and R2 backups
and independent restoration are
[manual responsibilities](./20-manual-recovery.md), with no supplied automation.

Recovery requires a working original server/database, the original firm and the
current owner's authenticated access to it. Possessing the private JSON file is
not sufficient. It cannot recover after loss of the original server, firm or
identity system; that needs administrator-operated PostgreSQL/PITR and R2 recovery.

## What works

- Only the current firm owner can read export status, export books, inspect an
  export, preview recovery or restore into a new firm. Accountant, sales and viewer
  roles are denied. The service independently checks membership as well as the
  route guard.
- Each export reads a single PostgreSQL `REPEATABLE READ`, `READ ONLY`
  transaction. Concurrent writes cannot produce a mixture of old and new rows.
  Queries run sequentially on that connection. This uses PostgreSQL's documented
  [snapshot isolation behavior](https://www.postgresql.org/docs/17/transaction-iso.html).
- Explicitly selected business columns include profile/invoice/reminder settings,
  parties, items, units, cash/bank ledgers, accounts, openings, voucher counters,
  vouchers and issued snapshots, lines, charges, allocations, postings, stock
  movements, document metadata, reminder history, complete voucher audit history,
  book controls, complete control-event history, loan terms/repayment references/
  audit events, opening-stock lots, imported opening bills/provenance, settlement
  entries/allocation history, credit approvals, order fulfillment snapshots,
  associate profiles/rules/deliveries/accruals/payouts and durable import receipts.
  Soft-deleted masters and
  document records are included, not silently filtered out.
- Auth accounts, password hashes, sessions, verification codes, invitations,
  team memberships, organization metadata/logo, idempotency/operation responses, read
  markers and sync cursors are excluded. Audit actor IDs/names and business bank
  details remain because they are part of the books. Treat the export as sensitive
  financial/personal data, even though login credentials are excluded.
- The versioned JSON format is validated before a file is returned. Inspection
  checks size, nesting, format/version, checksum, tenant ownership, duplicate
  record IDs, references and attachment paths. It does not validate the economic
  correctness of imported accounting figures or authorize any import.
- No SQL, table selection or object-download key comes from an uploaded file.
  Inspection never connects to R2 and never writes to the books.
- The file limit is 10 MiB UTF-8 and 25,000 business rows across all included
  tables, including child rows and history. Row reads are paged internally, but
  the download is one complete file. Oversize, incompatible or invalid data fails
  explicitly; no truncated file is returned. Larger firms need a managed database
  backup until a streaming archive implementation is available.

## Endpoints and Integration

The module is registered in `apps/api/src/app.ts`:

```ts
import { backupRoutes } from "./modules/backup/backup.routes";

await app.register(backupRoutes, { db, prefix: "/v1" });
```

Public schemas are exported from `packages/contracts/src/index.ts`:

```ts
export * from "./backup";
```

The implementation imports the public `@repo/contracts` barrel. Apply pending
migrations in `apps/api/src/db/migrations`, including
`0024_production_completion_snapshot.sql`, before using v4 exports. No
attachment-storage key changes are required.

All endpoints require authenticated requests and `X-Firm-Id`:

| Endpoint                          | Actual behavior                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /v1/backup/status`           | Counts including soft-deleted records, format limits, new-firm restore available, automatic backup unavailable  |
| `GET /v1/backup/export`           | `{ fileName, text }`; JSON download/share uses the existing native/web file helpers                             |
| `POST /v1/backup/inspect`         | `{ text }`; returns validated file summary and recovery warnings for the selected original firm                 |
| `POST /v1/backup/restore-preview` | `{ text, name }`; checks financial consistency and issues a 30-minute, owner-bound preview                      |
| `POST /v1/backup/restore`         | `{ text, previewId, confirmNewFirm: true, acknowledgeMissingAttachments: true }`; creates a new firm atomically |
| `GET /v1/backup/recovery`         | Original firm ID, recovery timestamp and current missing-file count for a recovered firm                        |

Responses use `Cache-Control: private, no-store`. Export/inspect/restore use a
per-route rate limit. Creating a file does **not** record a fictitious
`lastBackupAt`: the server cannot prove the browser downloaded it or the user
saved the phone's share-sheet result.

## File Format

The version-4 envelope is deliberately distinct from the old version-1 demo file:

```json
{
  "payload": {
    "app": "hisaab",
    "kind": "firm-books-export",
    "version": 4,
    "savedAt": "2026-10-17T00:00:00.000Z",
    "sourceFirmId": "<uuid>",
    "data": "<strictly validated business tables>",
    "attachments": {
      "coverage": "metadata-only",
      "binariesIncluded": false,
      "offsiteRecoveryVerified": false,
      "objects": []
    }
  },
  "integrity": {
    "algorithm": "sha256",
    "digest": "<64 lowercase hex characters>"
  }
}
```

The abbreviated example describes the envelope, not a complete import file.
`data` is an object defined by `FirmExportData` in `packages/contracts/src/backup.ts`.
The digest is SHA-256 of UTF-8 `JSON.stringify(payload)`. Whitespace around the
outer JSON does not matter; payload property ordering does. This checksum detects
accidental corruption, **not authenticity**: someone who edits a file can compute
a new checksum. A successful inspection is not a trustworthy restore approval.
Legacy demo files and unknown versions are rejected, never guessed or coerced.
Unmodified version-2 and version-3 exports are strictly validated against their
original schema and checksum, then upgraded with unset new columns and empty new
collections. Unknown fields are not silently discarded. New-firm recovery remaps
opening lots/bills, nested order and associate snapshots, payout allocations and
their relationships. Restored credit overrides are expired, not reusable approvals.

## Schema Evolution

`BackupRows` is the explicit column/validation registry. `backup.repo.ts` pairs it
with a fixed set of Drizzle tables. Export compares the actual database's public
firm-scoped tables and columns with this registry; `change_log`, `notice_reads`
and `operation_receipts` are explicitly excluded operational tables. An unknown table,
added column or missing column fails with `EXPORT_SCHEMA_CHANGED`.

When adding opening allocation, partners, commissions or any other financial data:

1. Update the explicit table/column schemas and database registry together.
2. Add reference and tenant validation, especially IDs in account keys, stock-lot
   keys and immutable snapshots. Never infer exportable tables from a file.
3. Version the export format when its meaning or shape changes. Retain explicit
   readers for older versions only when tested; do not make required fields
   optional merely to accept an incomplete export.
4. Extend `restore.remap.ts`, the fixed insertion order in `restore.repo.ts` and
   the financial checks for every new field/table. Unknown data must not be ignored.
5. Review export, inspection and restore behavior for the new records and update
   this inclusion list. Check older-file handling and future-version rejection.

Until that work lands, new financial schema may temporarily make export and restore
unavailable. That is intentional: silently claiming a complete export while
omitting new financial records is worse. This guard checks table/column shape;
semantic changes to existing fields still require format and recovery review.

## Attachment Manifest, Not Binary Recovery

Each document has a manifest entry with its ready/pending/deleted state, recorded
size/content type, original key and thumbnail key. Keys must be the canonical
`firms/<firm-id>/documents/<document-id>` path with an allowed extension; thumbnail
keys must match that original. No signed URLs, credentials, bucket endpoint or
user-chosen remote paths are exported.

Every object is explicitly marked `availability: "not-checked"`. A ready database
row is **not** proof that its R2 object still exists. Pending uploads may have no
usable binary; deleted documents may already have had their objects removed.
Originals and thumbnails are **not** copied into this JSON file or another bucket.
Cloudflare describes R2 objects as separately stored data identified by keys:
[R2 objects](https://developers.cloudflare.com/r2/objects/). Exporting the key does
not export those bytes.

A complete attachment-recovery system still needs a private independent archive,
checksummed original and thumbnail copies, per-object copy verification, retention
and deletion policies, encryption/access controls, manifest-to-object consistency
and a successfully exercised restore. Do not expire `firms/` objects as though
they were abandoned `pending/` uploads. Database export and R2 copying are not a
single atomic transaction; handle concurrent deletion/upload explicitly.

## Screen Behavior

Settings shows **Books export and recovery** with owner-only export and
recovery. The screen uses the selected firm's remote service, not the mock
backup service. Switching firms clears the preview. Demo users must sign in.

`Export books (JSON)` invokes the existing download/share helper. The success
message only says that the export was prepared and asks the user to verify its
destination. `Inspect an export file` shows its firm, timestamp, record counts,
version, checksum result and limitations. The owner enters a distinct recovered
firm name, requests a financial preview, then checks two confirmations: create a
new firm and accept missing attachment binaries. Changing the file or name clears
confirmation. A successful restore shows the new firm and an explicit **Open
recovered firm** action. It does not silently switch or overwrite the original.

The new firm is also available from the normal firm selector after refresh.
Recovered document rows retain names, folders, party/voucher/account links and
notes, but `s3Key`, `thumbnailKey` and `readyAt` are cleared. They cannot download
source-tenant objects. The recovery screen shows their missing-file count;
ordinary Documents listings exclude unready records, so these placeholders are
not usable images or downloadable files. No binary reattachment tool is supplied.
The retained origin record-ID map is provenance, not a file recovery mechanism;
see [manual recovery responsibilities](./20-manual-recovery.md).
Pending-upload cleanup must preserve keyless recovered metadata rows. Recovery
status counts only nondeleted, unready, keyless placeholders, not new upload
reservations. Do not describe these rows as recovered R2 documents.

Legacy `backupService.restore(text)` rejects replacement restore locally. It is
not used by this screen. Demo mode cannot use the real recovery actions.

## New-Firm Restore Guarantees and Limits

- Preview validates the complete format, links, stock lot identities, numbering,
  postings against current core calculations, journal totals, invoice totals,
  settlement capacity, stock movements/valuation and return/conversion links.
  Unsupported legacy/deficit books fail explicitly; they are not repaired by import.
- Confirmation is bound to the source firm, current owner, file digest and new
  name. It expires after 30 minutes. Successful retries return the same result
  while idempotency records are retained (currently seven days); an absent or
  expired preview never creates another firm. A later fresh preview is an explicit
  separate recovery request and may create another distinctly named firm.
- One PostgreSQL transaction inserts the new organization, owner membership and
  all business records. It holds the owner's source membership until commit.
  An owner-scoped advisory lock serializes confirmations and concurrent retries.
  PostgreSQL provides the required [transaction atomicity](https://www.postgresql.org/docs/17/tutorial-transactions.html)
  and [transaction-scoped advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html).
- A fixed registry inserts validated columns; the file cannot select tables or
  SQL. All record UUIDs, relation IDs, account keys, lot keys, snapshots and
  bank-clearing keys are remapped. Two-pass voucher insertion handles reciprocal
  order links. Actual persisted records must round-trip exactly before commit.
- Existing books are never updated or deleted. Imported audit/control events are
  inserted under new IDs. Historical actors receive new pseudonymous UUIDs and
  `[Imported]` names, not auth accounts. Only the restoring user receives owner
  membership. No old team members, invites, credentials or sessions are imported.
- A new immutable `restore-origin` book-control event records the source, digest,
  export/version timestamp, restoring owner and record/actor/lot ID maps. Imported
  event bodies (`changes`, `before`, `after`) retain their original text and IDs as
  historical evidence, not operational references. Historical issued names stay
  unchanged. The maps distinguish old evidence from new operational identity.
- Opening approval and period locks are retained and inserted last, without
  disabling database protections. Sync cursors are regenerated by normal database
  triggers. Restored reminder settings are disabled; no reminder jobs are copied
  or scheduled. Review the recovered books before enabling reminders manually.
- This JSON feature provides no binary copy, independent archive, automatic schedule,
  authenticity signature, R2 availability verification or disaster-recovery drill. A matching
  checksum is not proof that the economic facts are genuine. Retain the original
  evidence file independently and review restored balances before business use.

Deployment recovery must rely on separately operated PostgreSQL
backups/PITR and verified independent R2 copies with a documented restore drill.
This JSON export is useful evidence and portability data, not that infrastructure.

## Manual Recovery Checks

Use an isolated staging firm. Export and inspect its books, confirm recovery into
a new firm, and compare GST, non-GST and mixed trial balances, stock, issued
snapshots, allocations and audit history. Confirm the source books are unchanged
and that rejected or repeated confirmations do not create unexpected firms.

Check preserved opening approvals and closed periods before allowing writes.
Verify restored keyless document placeholders cannot obtain binary download
URLs or access source-firm files. A pending new upload must not be counted as a
detached restored attachment.

Keep source cached reads and queued operations scoped to the original firm.
Switching to a restored firm must not replay that outbox. Independently recovered
databases can be missing recent writes or retry receipts, depending on the backup
and restore procedure. Keep unresolved saves disconnected and follow
[manual reconnection responsibilities](20-manual-recovery.md#pending-saves-before-reconnection)
before allowing replay.

Status and export responses use `private, no-store`; a matching conditional
request must not replace an export with an empty response. Check file picking,
confirmation and firm switching on intended devices. A successful JSON recovery
does not verify database backups or attachment binaries; arrange separate
verification and an independent restore drill.

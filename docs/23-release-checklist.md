# 23. Release Checklist

[Documentation index](README.md)

Use this guide to prepare a selected release. It records responsibilities and
manual checks; no item here certifies a deployed environment or device.

## Known Implementation Follow-Ups

The [import guide](14-imports.md#known-gaps) records two source-confirmed gaps:

- Hydrate imported opening bills in notification/reminder scans so their original
  due dates are used.
- Translate the financial-import database guard `P0021` into a clear conflict
  response instead of a generic server error.

These remain code changes to make. They are not fixed by updating documentation
or by the manual deployment checks below; this is not an exhaustive bug audit.

## Manual Runtime Setup

Use the [root README](../README.md) and app READMEs for commands and manual builds.
Arrange hosting, PostgreSQL/Redis, private storage, HTTPS, runtime secrets and
process supervision separately. Start the API and worker independently.

Back up and verify the database before applying pending migrations. Pause
API/worker writes, use `bun run --cwd apps/api db:migrate`, and stop the rollout on
migration failure. Never use schema push or seed commands to upgrade business books.

Check API readiness and worker health separately. On the deployed host, verify
sandboxed PDF rendering, reminder preparation, private signed downloads and
any separately configured monitoring/alert delivery. Reminder preparation does
not send messages; the repository does not configure alert routing.

## Recovery and Storage

Assign owners for database and object-storage backups, independent private copies,
retention and restore drills. No full backup or recovery automation is supplied.
Use [manual recovery responsibilities](20-manual-recovery.md) to plan access
recovery and review unresolved client saves before reconnecting devices. Record
recovery time and acceptable data loss from an independent restore drill.

[Books exports](19-backup-recovery.md) restore into a new firm and contain attachment
metadata, not attachment binaries. Arrange separate recovery and verification of
originals and thumbnails; no binary reattachment tool is supplied. Keep customer documents and backups private;
public APKs use a separate release bucket and credentials.

Review private-bucket CORS, public-domain and lifecycle settings using
[storage setup](16-document-storage-setup.md). Expiration for abandoned uploads must
not remove saved firm objects.

## Manual Product Checks

Use staging with sample books to check a sale, allocated receipt, return, stock
movement and reports in GST, non-GST and mixed views. Compare balances after
restart and confirm role/firm isolation and period locks.

On intended devices, check camera/gallery permissions, readable attachments,
sharing, offline entry, process restart, reconnect and low-storage behavior.
Use [offline books](17-offline-books.md) and [attachment recovery](18-attachment-recovery.md)
for recovery limits. Browser cold starts and reloads require network access;
check offline reads/writes in an already loaded browser app and restart recovery
on native devices. Use the [native README](../apps/native/README.md#manual-expo-builds)
for manual Expo builds, and verify signing and download integrity before publication.

Record the deployed commit, migration outcome, operational owners and unresolved
issues. Hosting, privacy/retention terms and support arrangements need owner review.
Availability and recovery depend on the manually configured environment.

## Product Decisions

- English-only accounting and management with GST, non-GST and mixed books.
- Commission accrues on discounted sale value excluding GST and freight; returns reverse it.
- Loan interest is calculated from saved terms and posted only after review.
- No silent rewriting of financial history or public access to customer attachments.

See the [module guide](03-backend-modules.md) for feature documentation and
[product scope](01-product-scope.md) for future boundaries.

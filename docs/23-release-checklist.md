# 23. Release Checklist

[Documentation index](README.md)

Use this guide to prepare a selected release. It records responsibilities and
manual checks; no item here certifies a deployed environment or device.
The [latest system audit](29-system-audit-and-work-plan.md) contains the current
open findings and repair order. The [earlier audit](27-private-readiness-audit.md)
retains F01-F18 repairs and G-phase evidence. The
[backup and migration plan](30-postgres-r2-backup-and-ec2-migration.md) describes
the requested opt-in daily R2 backup. [Doc 31](31-implementation-and-verification.md)
records the new repairs and their checks; live backup credentials and external
monitoring must still be configured and verified before relying on automation.
For the implementation order and hosting walkthrough, start with the
[completion plan](24-completion-plan.md), then guides 25 and 26.

## Application Repairs and Remaining Release Work

The 26 October implementation pass resolves the application findings in
[Doc 27](27-private-readiness-audit.md), including imported-bill reminders,
`P0021` conflict translation, bounded readiness and health-check quota immunity.
The audit records each fix's checks and limits. Native storage simulations do
not replace a physical-device check, and local builds do not verify deployment.

G03's updated R2 CORS passed production-origin browser verification on 26 October.
G01 registration/firm isolation and G02 dependency repairs/triage are locally
complete. G04 supplies tested container/workflow configuration; G05's isolated
database/object rehearsal passed. Resolve the additional findings in Doc 29.
Still configure the EC2 PostgreSQL/Redis services, verified
email, EC2/Docker Hub/HTTPS and retained independent backups, then perform actual
provider recovery and phone/deployed acceptance. Apply migrations 0025 and 0026 after a
verified backup, with API/worker writes paused and coordinated client updates.

## Manual Runtime Setup

Use the [root README](../README.md) and app READMEs for commands and manual builds.
Arrange hosting, PostgreSQL/Redis, private storage, HTTPS, runtime secrets and
process supervision separately. Start the API and worker independently.
The supplied container setup and owner steps are in
[Docker and CI/CD](25-docker-and-cicd.md) and
[EC2 and Expo deployment](26-ec2-and-expo-deployment.md). Follow their configuration
and acceptance sequence before enabling production deployment.

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

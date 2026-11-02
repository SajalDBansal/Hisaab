# 20. Manual Recovery Responsibilities

[Documentation index](README.md) | [Firm JSON export](19-backup-recovery.md)

A full recovery needs the database, private file bytes, application version and
separately protected configuration. The procedure below is manual; it adds no script
framework. Production now runs PostgreSQL/Redis containers on EC2; use
[guide 26](26-ec2-and-expo-deployment.md) for container dump/restore commands.
The deployment workflow's pre-migration dump stays on EC2 until you copy it
elsewhere; it is not an independent backup or a scheduled backup service.

**Optional worker automation:** [Doc 30](30-postgres-r2-backup-and-ec2-migration.md) specifies
the owner's requested daily 02:00 Asia/Kolkata PostgreSQL backup to private R2,
retaining the latest completed archive, and a move to another EC2/account.
It requires separate private configuration and explicit enablement. Retain these
manual procedures and rehearse recovery; [Doc 31](31-implementation-and-verification.md)
records implementation checks and remaining provider/device acceptance.

Hisaab supports separate accounts and firm memberships. The current deployment
may have one user, but recovery must preserve each original account ID and its
actual memberships. An installation operator is not automatically the owner of
every firm. There is no global owner-email allowlist in this procedure.

The 26 October 2026 rehearsal below passed on disposable databases and synthetic
R2 objects. EC2 volume restoration, independent retained backups and actual
device reconnection remain installation-owner work before primary-ledger use.

## Prepare the Recovery Record

Keep this record with the encrypted backup, accessible if the application host
and its ordinary credentials are lost. Do not put secrets in Git or this guide.

| Record            | What the installation operator must supply                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Responsibility    | Named backup operator and a trusted alternate; provider/account recovery and MFA recovery access                                           |
| Recovery targets  | Maximum acceptable lost work (RPO), maximum outage (RTO), and who decides the cutover                                                      |
| Retention         | Actual daily/weekly/monthly retention and deletion policy for both database and files; provider PITR window and last successful backup     |
| Independent copy  | Private encrypted destination outside the live bucket/host, its access policy, and a separately recoverable encryption key                 |
| Release           | Application commit plus any uncommitted patch or exact build, lockfile, PostgreSQL version, applied migration journal and backup UTC times |
| Configuration     | API and worker settings, database roles/grants, storage endpoint/bucket/CORS/lifecycle policy, email sender, DNS/TLS and proxy settings    |
| Secrets           | Recoverable `BETTER_AUTH_SECRET`, database/Redis/storage/mail credentials and encryption keys, held separately from backup files           |
| Installed clients | Current and previous signed release, application ID/package name, signing keystore and passwords, API origin and app scheme                |
| Evidence          | Database archive SHA-256, per-object hashes and manifest, restore results, unresolved writes and explicit missing files                    |

A copy elsewhere in the same R2 bucket does not survive loss of that bucket or
account. Hashes detect corruption; access controls, encryption and the separately
protected evidence record establish which backup the operator should trust.
Define and activate retention for EC2 snapshots and independent copies; no policy is
configured by writing this record. Do not apply an expiry rule to live `firms/`
objects. See [storage setup](16-document-storage-setup.md).

## Take a Consistent Database and File Set

1. Record the backup boundary in UTC. Pause API writes, stop workers and keep
   clients with pending saves offline. Prevent deletion/cleanup and new upload
   confirmations during the copy. Let outstanding signed uploads finish or expire;
   record remaining pending uploads and preserve their device files. Keep the
   write pause until the database dump and object verification both finish.
2. Use the matching PostgreSQL client major version. A PostgreSQL 17 custom-format
   dump preserves database tables, sequences, constraints, triggers and migration
   history. Keep `user`, `account`, `member`, business/audit data, `change_log`,
   `idempotency_keys` and `operation_receipts`. Exclude ephemeral sessions, email
   challenges, identity tickets and outstanding invitations as shown below.
3. Read the document manifest from that frozen database. For every required
   ready, nondeleted document, download both `s3_key` and `thumbnail_key`, retaining
   the exact key, firm/document ID, content type, byte count and SHA-256 of each.
   Missing bytes are an explicit backup failure for that document. Record pending,
   deleted and keyless recovered rows separately; none proves a usable file.
4. Store the manifest and verified bytes in the independent encrypted archive.
   Compare the downloaded bytes with a separate read/copy and its hash; an ETag
   alone is not the archive checksum. Test decryption with the separately held key.
5. Verify the database archive hash after transfer and inspect `pg_restore --list`.
   Record completion only after every required component is available, then
   restore into a separate target before calling the backup usable.

PostgreSQL gives `pg_dump` a consistent database snapshot, but that snapshot does
not include object storage or cluster roles. Save required role/grant configuration
separately, following the target database's access rules. Sources:
[PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

The following PowerShell examples apply to separately reachable PostgreSQL
targets. Keep production database ports private; use guide 26's container commands
over SSH for EC2, rather than opening port 5432. Configure
`hisaab-backup`, `hisaab-restore-admin` and `hisaab-restore-drill` as distinct,
reviewed PostgreSQL service entries first; keep passwords in the protected
password file, not shell history. `hisaab-restore-drill` must name the new empty
restore database, never the live database. Run in a private archive directory.
See the [PostgreSQL service-file format](https://www.postgresql.org/docs/17/libpq-pgservice.html).
These examples were not run against business books.

```powershell
pg_dump --dbname='service=hisaab-backup' --format=custom --no-owner --no-acl `
  --exclude-table-data=public.session `
  --exclude-table-data=public.verification `
  --exclude-table-data=public.recovery_identity_tickets `
  --exclude-table-data=public.replaced_sessions `
  --exclude-table-data=public.invitation `
  --file=books.dump
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
Get-FileHash -LiteralPath books.dump -Algorithm SHA256
pg_restore --list books.dump
if ($LASTEXITCODE -ne 0) { throw 'Archive inspection failed' }

createdb --maintenance-db='service=hisaab-restore-admin' `
  --template=template0 hisaab_restore_drill
if ($LASTEXITCODE -ne 0) { throw 'Empty restore target was not created' }
pg_restore --dbname='service=hisaab-restore-drill' --no-owner --no-acl `
  --exit-on-error --single-transaction books.dump
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; keep the target isolated' }
```

The archive is not encrypted by `pg_dump`; protect it before storage or transport.
Use file output, not a PowerShell text pipeline, for the binary archive. These
commands omit cluster ownership/ACL restoration; apply the reviewed application
role and grants explicitly. A provider snapshot/PITR restore is an alternative,
with its own isolated-target procedure and evidence requirement.

For the file inventory, a trusted operator can export these fields from the
frozen database; this query describes the database, not bucket contents:

```sql
SELECT firm_id, id AS document_id, s3_key, thumbnail_key,
       content_type, size_bytes, ready_at, deleted_at
FROM public.documents
ORDER BY firm_id, id;
```

A stored original may have been processed after upload; hash its downloaded
bytes, not the phone's original. Pending objects use `pending/<original-key>`.
Preserve recoverable pending bytes/device originals explicitly, without treating
them as confirmed attachments. Generated PDFs under `firms/.../generated-pdfs/`
are separate artifacts: retain them if required, or record that they must be
regenerated after review. Include externally stored firm logos if the installation
uses them. Neither metadata rows nor an R2 CORS policy is a binary backup.

## Restore While Clients Stay Disconnected

1. Restore the archive into an empty, isolated database, retaining original user,
   firm, voucher and document IDs. Use the recorded compatible release first.
   Inspect the restored migration journal before applying any newer migration;
   never run the seed command on recovered books.
2. Restore verified files into a private isolated bucket/account with the same
   object keys. Point the isolated API only at that destination. A rehearsal on
   the existing bucket may instead use wholly synthetic firms/keys; never point
   restored business fixtures at the live bucket for a deletion experiment.
3. Keep workers and external email/reminders disabled. Start with a separate Redis
   target/namespace; PostgreSQL holds financial retry receipts. Do not reconnect
   old BullMQ jobs blindly or flush a shared Redis service. Review/recreate needed
   jobs after reconciliation; cache and queue state is not the accounting backup.
4. Restore API and worker configuration deliberately. Both need the recovered
   database and storage; the worker has its own settings. Recover
   `BETTER_AUTH_SECRET` from the secret store. If unavailable or exposed, create a
   new secret, invalidate prior sessions/challenges and require new login; do not
   promise old cookies or signed previews still work. Storage and email tokens can
   be reissued with the required permissions and verified before cutover.
5. Require fresh sessions even when the archive retained password accounts. The
   dump example excludes ephemeral auth data. A provider/PITR restore may retain
   it: invalidate sessions, email challenges, identity tickets and pending invites
   in the isolated restored database before exposing normal routes. Preserve
   users, credential accounts, memberships and durable business receipts.
6. Start normal mode only on the restricted validation endpoint. Log in as each
   affected firm owner through ordinary authentication. Check their original
   account ID and memberships and deny another account access to their firm.
   Verify GST, non-GST and combined balances, dated openings, stock quantities and
   value, outstanding bills, issued snapshots, closed periods and audit history.
   Download originals and thumbnails through authenticated API tickets and compare
   bytes with the manifest. Check an unauthenticated request is denied.
7. Review password changes, membership/invitation changes, reminders, deletions and
   financial writes newer than the backup. A restore can resurrect old credentials
   or permissions. Resolve that gap before exposure. Restore signing credentials
   and install a same-ID, same-signing-key client upgrade on the intended device;
   changing the application ID/key or clearing app storage can strand pending work.
8. Finish the pending-save reconciliation below, record the chosen cutover time,
   and admit clients deliberately. Re-enable reviewed jobs/reminders last. Keep the
   old system isolated and retain its evidence; record the drill outcome and next
   drill date with the actual RPO/RTO achieved.

A JSON new-firm restore remaps IDs and clears file keys. It cannot be turned into
a full-system restore merely by placing old files in a bucket. Use
[guide 19](19-backup-recovery.md) for its separate limitations.

## Recover an Account Without Changing Its Ownership

With intact `user` and `account` rows, prefer ordinary login or the normal emailed
password-reset flow. Test delivery to the existing account's verified mailbox;
do not send recovery codes to an operator-selected replacement address. A full
database restore retains credential hashes and memberships; firm JSON does not.
If the mailbox is lost, stop for independently witnessed identity verification.
Possessing a financial export or knowing a firm name is not proof of account
ownership. Do not enable an account takeover by changing the restored email.

`APP_MODE=recovery` exposes health routes and
`POST /v1/recovery-operations/redeem`. It mounts no normal auth, firm or document
routes, and the worker refuses recovery mode. Keep this API loopback-only or on a
restricted operator network. It does not restore data, issue tickets or sign in a
user. Merely starting recovery mode cannot repair missing authentication.

Use its existing redemption endpoint only for a restored identity that has
**no account credentials and no session rows**. This is a separate operator path,
not a password-reset shortcut:

1. Keep normal API and all other writers stopped. Verify the trusted archive's
   hash, the exact restored user ID/email and their existing firm memberships.
   Independently verify the person and control of that exact mailbox, using a
   trusted channel and an identifiable witness. Record who verified what and when
   in a protected evidence record. The database email or archive possession alone
   is insufficient. If proof is unavailable, do not issue a ticket.
2. Generate 32 cryptographically random bytes, encoded as 43 unpadded base64url
   characters, in the trusted operator session. Keep the raw secret out of SQL,
   logs, URLs, shell history and the backup. Compute its lowercase SHA-256. Deliver
   the raw secret to that verified person/mailbox separately from the archive.
3. Insert one short-lived ticket using the existing table, binding that hash to
   the exact user/email, verified archive SHA-256 and evidence reference. Use a
   parameterized database client or properly quoted `psql` variables. For example,
   after setting the five values from the completed verification:

   ```sql
   BEGIN;
   SELECT id, email FROM public."user"
   WHERE id = :'verified_user_id'::uuid AND email = :'verified_email'
   FOR UPDATE;
   INSERT INTO public.recovery_identity_tickets
     (user_id, email, token_hash, archive_digest, evidence, expires_at)
   SELECT u.id, u.email, :'token_sha256', :'archive_sha256',
          :'proof_reference', now() + interval '30 minutes'
   FROM public."user" u
   WHERE u.id = :'verified_user_id'::uuid AND u.email = :'verified_email'
     AND length(trim(:'proof_reference')) > 0
     AND NOT EXISTS (SELECT 1 FROM public.account a WHERE a.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.session s WHERE s.user_id = u.id)
   RETURNING id, expires_at;
   COMMIT;
   ```

   Require exactly one inserted row. If none is returned, stop and review; never
   delete credentials or sessions just to make a ticket eligible. Do not change
   memberships, recreate the user under a new ID or extend expired tickets. The
   schema allows at most one hour; the example uses 30 minutes. No automatic
   identity-verification or ticket issuer is being added.

4. The verified person submits `{ token, email, password }` in the HTTPS request
   body (or through a trusted local tunnel), with a new password of 12-128
   characters. Do not put these values in a URL or a saved shell command. A success
   is `{ enrolled: true, signInRequired: true }`; no cookie/session is issued.
   Redemption rejects wrong email, expiry, a consumed ticket, existing credentials
   or any session, and uses the authentication library's password hash format.
5. Remove the delivery copy of the secret; retain only the protected evidence
   reference and ticket outcome. Shut down recovery mode, resume restricted normal
   mode and verify ordinary login and the original firm permissions. Only then
   continue normal cutover review. Phone verification remains false after
   re-enrolment; a restored name/phone is not new identity proof.

The endpoint records an archive digest/evidence supplied by the operator; it does
not independently verify that archive or witness. A test-created ticket proves
redemption behavior, not that a real person's identity has been verified.

## Pending Saves Before Reconnection

Keep affected devices disconnected. Preserve the signed-in account and original
firm, cached books, queued payload, original request/operation key, local file
copies and any prior response. Do not uninstall, clear storage, select a new firm
for replay, generate a fresh key or discard a draft to silence an error.

For each pending save, compare the restored receipt and referenced business row
with original request content, audit history, the pre-restore server if available,
and external evidence. Keep the original user/firm scope throughout.

| Evidence after restore                                                | Operator action                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching durable receipt and matching business row                    | Controlled retry with the original key can return the original result; verify exactly one entry before resolving the local draft                                                                                       |
| Business row exists but receipt is missing, or answer/payload differs | Keep replay blocked; reconcile the specific entry and retain evidence. Do not invent a receipt or issue a new key                                                                                                      |
| Neither row nor receipt is present                                    | Determine whether the operation occurred after the backup or never committed. A missing receipt alone proves neither. Re-enter only after reconciliation establishes it is absent, using an explicit reviewed decision |
| Object/metadata mismatch or uncertain upload                          | Preserve the original local file and reservation identity; verify object bytes and association before retrying confirmation or uploading again                                                                         |
| Owner, membership or book-control state differs                       | Resolve authorization/period changes first; do not bypass them to replay                                                                                                                                               |

There is no automated cutover or unresolved-save quarantine. Until every uncertain
write is resolved, keep that device offline; the client may replay automatically
when it reconnects. Even durable receipts cannot answer a write newer than the
restored database. Rebuild stale read/sync state only after pending writes and
files have been preserved and reconciled. See [offline books](17-offline-books.md)
and [attachment recovery](18-attachment-recovery.md).

## Rehearsal Evidence

**26 October 2026.** The focused harness used PostgreSQL 17.11 at `127.0.0.1:55440`, two distinct
`g05_source_*` / `g05_restore_*` databases, migrations 0000-0026, the current
working-tree application based on `2404c08` (including uncommitted repairs),
in-process HTTP and a memory email sender. It did not
use business records, send email or create cloud resources.

| Check                        | Observed result                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database archive             | Real custom-format `pg_dump`, local file copy and `pg_restore --exit-on-error --single-transaction` into the empty second database passed; 27 migration entries retained                                                                                             |
| Authentication and isolation | Two original accounts retained password hashes, user IDs and owner memberships. Both fresh logins worked; cross-firm requests returned 403 in both directions, and pre-backup cookies failed because sessions were excluded                                          |
| Books and retry              | A synthetic expense of 12,500 paise retained identical balanced all/GST/non-GST trial balances; GST was zero for this unregistered fixture. Original-key retry returned the same voucher and left exactly one entry                                                  |
| Files                        | A real synthetic image and generated thumbnail were copied in R2, downloaded to local files and SHA-256 checked. Both source objects were deleted, proved absent, restored from local bytes at their exact keys and successfully downloaded through the restored API |
| Object access                | Unsigned requests to the synthetic S3 object URL returned HTTP 400 `InvalidArgument`; signed reads worked. Unauthenticated API download was denied. Public/custom-domain bucket configuration was not inspected                                                      |
| Recovery boundary            | Normal auth/business routes returned 404 in recovery mode. Unknown, expired, wrong-email, mismatched-identity, existing-account and existing-session tickets failed. Six concurrent redemptions yielded one credential, five rejections and no session; reuse failed |
| Cleanup                      | Each exact synthetic object key was deleted and checked absent in `finally`; both owned databases, temporary dump/byte copies and the harness were removed                                                                                                           |

The final synthetic archive was 218,812 bytes; SHA-256:
`8fb68ad60e76d60bcd3e2e3bfa602a6bc68bbd2a886ae68699d7bead76293fdb`.
It was removed after verification and is not a retained backup.

This is an isolated logical restore on one temporary PostgreSQL server, with
synthetic copies in the existing R2 bucket and temporary local file backups. It
is not evidence of retained offsite copies, an encrypted archive/key recovery,
a provider/PITR or whole-host disaster restore, full financial edge cases, stock
restoration, real email delivery, generated-PDF recovery or physical-device
reconnection. The original/thumbnail byte check does not certify bucket settings
for every access route. No recovery code defect was found in these checks.

The installation operator still owns provider selection and backup/PITR retention,
a durable independent encrypted archive, account/MFA/key recovery, a timed restore
into separate provider targets, and a supervised phone/browser pending-write
cutover. Record those results before closing G05 for the installation. No real
business restore, database mutation, cloud deployment, commit or push was done.

# 16. Private Document Storage Setup

[Documentation index](README.md)

## Image processing

- Entry forms keep their existing multiple-attachment selection, up to ten files
  per batch. Each file has an independent document record and retry state.
- Photos are resized to at most 2560 pixels on the long edge and encoded as
  JPEG at quality 85 on the phone/browser before upload. PDFs are unchanged.
- The API verifies uploaded bytes and decodes/re-encodes images, removing EXIF
  metadata, normalizing orientation and limiting decoded input to 40 megapixels.
- A separate JPEG preview, at most 320 pixels on the long edge at quality 60,
  is stored under `<document-key>.thumb.jpg` in the same private bucket.
- Lists request the preview only. Open, Download and Share request the readable
  image. A thumbnail still transfers a small amount of data; it is not zero-byte.
- Old saved files are not silently rewritten. Files without stored previews show
  their document icon until the explicit thumbnail backfill below is run.

The client uses `expo-image-manipulator`. Browsers that cannot decode HEIC ask for JPEG/PNG or the mobile
app. [Expo image processing](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/).
Server decoding is bounded and corrupt images are rejected.
[Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/).

## Server environment

Keep these in `apps/api/.env` or server deployment secrets. Configure
`apps/worker/.env` for the same private bucket when using server-generated PDFs:

```dotenv
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=<private-bucket-name>
R2_ACCESS_KEY_ID=<bucket-scoped-access-key>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_ENDPOINT=
```

Leave `R2_ENDPOINT` empty for the standard account endpoint; set it only for a
different required jurisdiction S3 API endpoint, never a public/custom-domain URL.
The server uses R2's `auto` region.
No new thumbnail bucket, public domain, image-service subscription or client
secret is needed. Never put these credentials in an `EXPO_PUBLIC_` variable.

## Bucket permissions and CORS

Use a private bucket with public access and `r2.dev` disabled, and an Object Read
& Write credential restricted to that bucket. Presigned URLs grant temporary
access to one object; keep them out of
logs, analytics and public pages. Both the full image and the preview use the
same firm membership checks. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

For the browser version, include the signed-in application's production origin
in the bucket CORS policy. Keep any existing development origins you still use:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:8081",
      "http://localhost:19006",
      "http://192.168.0.205:8081",
      "https://app.hisaab.sajaldbansal.com"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Include your actual Expo web port and LAN origin when testing from another device.
In Cloudflare, open R2 → the configured private bucket → Settings → CORS Policy,
add the production origin to the saved rules and save. An Object Read & Write
credential cannot manage this bucket setting; use the owner's dashboard access.
Do not make the bucket public to fix CORS. Native Expo does not use browser CORS, but web
uploads/downloads do. [R2 CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/).

**Verified 26 October 2026 after the owner's update:** all four origins above
passed PUT/GET/HEAD preflight checks. An isolated browser page with the production
origin uploaded a synthetic image and read its processed JPEG, thumbnail and
signed metadata successfully. File bytes matched, and all test objects were
removed. An unapproved origin was rejected. See
[G03 verification](27-private-readiness-audit.md#g03--add-the-production-app-origin-to-private-r2-cors)
for the test boundaries; the full deployed app and phone sharing still need
their normal acceptance checks.

Add an expiration rule only for the `pending/` prefix, such as seven days. Do
not expire `firms/`, where saved images and thumbnails live. Retention on staging
permits interrupted confirmations to retry; abandoned staging data is then
removed by R2. [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Applying the code

Review all pending migrations before updating a checkout or deployment.
Document metadata starts with `0007_document_attachments.sql` and preview
metadata with `0010_document_previews_english.sql`, under
`apps/api/src/db/migrations`. Apply the current set, not just those two files.
Rerunning migrations skips applied files. Back up the target database and pause
API/worker writes before an upgrade.

From the repository root:

```powershell
bun install --frozen-lockfile
```

After taking a database backup, also run from the repository root:

```powershell
bun run --cwd apps/api db:migrate
bun run --cwd apps/api dev
```

Each application environment uses its configured `DATABASE_URL`.

Restart Expo with a cleared Metro cache. For a physical phone, use your computer's
current LAN address rather than `localhost`:

```dotenv
EXPO_PUBLIC_REQUIRE_LOGIN=true
EXPO_PUBLIC_API_URL=http://<computer-lan-ip>:3000
```

Run `bun run --cwd apps/native start --clear` in another root terminal, keep both devices on the same
network, allow the API port through the private-network firewall, and confirm
the API is bound to `0.0.0.0`. Production must use the HTTPS API address. Expo Go
must match the project's SDK; a custom development build needs rebuilding after
installing the native image-manipulator module.

## Required owner checks

1. Upload two readable bill photos from camera/gallery against one entry.
2. Restart the app, find them by party/date/folder and open the full images.
3. Verify small printed bill text is readable after compression before routine use.
4. Download/share a photo on both Android and iOS. Browser verification is not a
   substitute for the operating system's camera, gallery and sharing permissions.
5. Confirm backup/retention policy covers both database metadata and R2 objects.
   A separate thumbnail can be rebuilt, but the readable document cannot be
   recreated from its thumbnail.

Restore and independent document-bucket protection remain operator responsibilities.
Optional database backup automation is configured separately in
[guide 30](30-postgres-r2-backup-and-ec2-migration.md).
Working image storage does not verify database or attachment backups.

## Storage limits and safe upload retries

Document routes accept `limits: { maxBytes, maxFiles }` alongside `db` and
`storage`. Both must be positive safe integers; omitted values default to 1 GiB
(`1073741824` bytes) and 10,000 files per firm. Pass deployment configuration at
route registration; do not pass limits from a caller's request body. Invalid
configuration fails registration instead of silently removing the limit.

```ts
await app.register(documentRoutes, {
  db,
  storage,
  prefix: "/v1",
  limits: { maxBytes: 1073741824, maxFiles: 10000 },
});
```

The logical quota includes each live ready document and each real pending upload
reserved within the last 24 hours. Every image reserves an additional 128 KiB
for its thumbnail, even when the actual preview is smaller or not yet created.
Firm-level transaction locks prevent concurrent requests exceeding either limit.
Confirmation checks normalized output size before storage writes and before
publishing the document. Capacity failures return `DOCUMENT_QUOTA_EXCEEDED` (409).

Pending reservations expire after 24 hours without deleting their metadata or
objects. Renewing or confirming an expired reservation must acquire capacity
again; changing its folder/note does not extend the reservation. Soft-deleted
documents do not count. Restored recovery records with no storage key and no
`readyAt` are not uploads: they remain available to the recovery manifest and are
neither charged as reservations nor purged. No reservation cleanup deletes rows.

These are application quotas, not a hard limit on Cloudflare charges. Temporary
`pending/` copies, failed cross-service writes, generated PDFs, and backups can
consume additional bucket space. Keep the staging lifecycle rule above and
monitor R2 usage separately. PostgreSQL and object storage cannot commit atomically;
a failure after an object write can leave an unreferenced object for operator-led
reconciliation. The document service performs no bucket-wide scan or deletion.

Send one stable `Idempotency-Key` for each logical attachment to
`POST /v1/documents/upload-url` (also supported by `POST /v1/documents`). Same user,
key, firm, route, and body returns the same document ID, including concurrent
retries. Reusing a key with different input returns `KEY_REUSED` (422). Preserve
the same endpoint and body on retries. A deleted reservation is not recreated.
Migration `0025_durable_retry_answers` retains reservation identities permanently,
even after the worker removes the seven-day response cache. New reservations use
UUIDv7 keys. Preserve each pending draft's original key and document ID; replay
returns that ID and renews its signed URL through the usual access checks. Old
UUIDv4 keys with a retained answer still replay. If the old answer was already
lost, `RETRY_RESULT_UNKNOWN` requires reconciliation rather than a fresh upload
under a different key. Update API, worker and clients together for this protocol.

The reservation and replay record commit before a URL is signed. A temporary
signing failure can therefore be retried safely. Only the document ID is stored
in the replay record, never a presigned URL. Replays generate fresh staging URLs;
if the original document already completed, confirmation returns that existing
document without replacing its readable file. Upload/download/thumbnail ticket
responses use `Cache-Control: private, no-store`.

Document list, search, folder, full-file and thumbnail reads share role filtering:
sales users can see permitted sales-side entry documents or customer-party
documents, not journal, account-linked, supplier or general-library documents.
An additional customer link never bypasses a restricted voucher. Other existing
book-reading roles retain their normal visibility. Firm isolation applies before
any URL is signed. A URL already issued remains usable until its ten-minute
expiry, even if a user's role changes in the meantime.

## Explicit legacy thumbnail backfill

The `backfillDocumentThumbnails` helper is in `apps/api/src/lib/backfill-thumbnails.ts`.
It is not automatically scheduled or exposed as a public endpoint. An authorized
operator may invoke it for one firm after backup/retention checks:

```ts
const batch = await backfillDocumentThumbnails(db, storage, {
  firmId,
  limit: 25,
  // afterId: previousBatch.nextCursor,
});
```

The default batch is 25, maximum 100. Continue with `nextCursor` until absent;
inspect `failures` rather than treating a finished batch as universal success.
After fixing a failure, restart from the beginning: already completed thumbnails
are excluded, so retries are bounded and idempotent.

Only live, ready JPEG/PNG/HEIC/HEIF records with a stored full-file key and no
thumbnail are candidates. Pending, deleted, PDF and keyless recovery records are
skipped. Each full-file key must belong to that firm's `documents/` prefix.
Originals larger than 10 MiB, missing objects, corrupt images and unsupported
decoders are reported as failures, not silently rewritten. Backfill verifies the
source ETag, reuses the existing bounded image processor, and creates a private
preview with an atomic `If-None-Match: *` PUT. An already-created valid preview
can be reused after a lost database commit. It never replaces the original or
an existing thumbnail. [R2 conditional object writes](https://developers.cloudflare.com/r2/api/s3/api/).

Only `thumbnailKey` and ordinary update/sync metadata change. Full-file keys,
bytes, MIME types, ready dates, voucher links and accounting history stay intact.
The helper uses one sequential transaction per file and the same firm/document
locks as upload confirmation and deletion. Storage implementations must support
`createThumbnail(key)`.

## Storage Runtime Bounds

S3 requests use a five-second connection timeout, a thirty-second request timeout
configured to throw (not only warn), a thirty-second socket inactivity timeout,
and at most three attempts per request. Several storage calls may be required for
one confirmation, so these are per-request bounds, not a thirty-second deadline
for the entire upload workflow.

The API configuration wires these optional server-only environment values to
the route limits described above:

```dotenv
DOCUMENT_STORAGE_MAX_BYTES=1073741824
DOCUMENT_STORAGE_MAX_FILES=10000
```

`app.ts` passes `limits: { maxBytes: env.DOCUMENT_STORAGE_MAX_BYTES,
maxFiles: env.DOCUMENT_STORAGE_MAX_FILES }` to `documentRoutes`. They have the
same 1 GiB / 10,000-file defaults when omitted. See `apps/api/.env.example`.
The quota mutex uses a dedicated `documents:<firmId>` namespace, followed by
the document lock, and stays held through finalization. It does not hold the
financial posting mutex while waiting on R2. Normal document update triggers
still take their ordinary short sync/change-log locks when metadata is saved.

## Manual Storage Review

No orphan-scanning, encrypted quarantine or binary reattachment command is
supplied. Failed cross-service writes can leave unreferenced objects; reviewing
database references and private storage remains a manual responsibility. Preserve
unknown files and account for pending uploads, deleted records and recovered
metadata before deciding on retention. Do not apply broad deletion rules to
`firms/`.

JSON-restored document rows are metadata-only placeholders. Their origin record
maps do not restore original files or thumbnails. Arrange independent private
copies and a verified restore procedure; see
[manual recovery responsibilities](20-manual-recovery.md).

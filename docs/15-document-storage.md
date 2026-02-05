# 15. Documents and Attachments

[Documentation index](README.md)

## Implemented

- Camera, gallery and PDF/image picker on sale, purchase, receipt, payment, expense, journal, financing, contra, return and order/challan forms, including invoice edits.
- Multiple attachments per entry, plus supporting documents for account/ledger masters and their statements.
- Settings > Business > Documents: search, multi-select party/account/type filters, upload-date or entry-date ranges, nested folders, previews, download/share, moves and deletion.
- A journal's documents match every party/account in its posted lines. Account filters include a document's direct account link as well as voucher postings.
- Files are limited to 10 MiB each, with up to 10 selected at once. Supported formats: JPEG, PNG, HEIC/HEIF and PDF.

On phones, Download opens a destination-folder picker and Share opens the system share sheet. Browsers download directly; sharing uses Web Share when supported, otherwise it downloads a copy.

Supported forms preserve the request, operation key and local attachment copies
before saving. Transfers follow confirmed accounting saves; retrying an attachment
does not repost the entry. Pending copies and failure states survive restart when
local storage remains intact. Use Pending uploads to retry or discard them; see
[attachment recovery](18-attachment-recovery.md) for scope and limits. Confirmed
documents remain in PostgreSQL/R2 across restarts. Browser builds need network
access to open or reload, as described in [offline books](17-offline-books.md).

Folders are document metadata, not public bucket directories. A nested folder appears once it contains a confirmed file; empty folders disappear. Moving a document changes its folder without copying the stored object.

## Setup

Use [Private document storage setup](16-document-storage-setup.md) for the server
environment, bucket permissions, CORS, lifecycle rules, migrations and thumbnail
backfill. It is the configuration reference; this guide covers user behavior.

Allow camera/photos access when prompted. Expo Go must match the project's SDK;
custom builds need the included picker modules and permission strings. Legacy
metadata-only documents are not verified uploads; reupload their files.

## Storage and Permissions

- Upload URLs last five minutes, download URLs ten minutes. Signed URLs are bearer credentials; do not log or publish them.
- The API checks firm membership and entry-specific write permissions before issuing uploads, confirming, moving or deleting. Lists and downloads also enforce role permissions; sales users cannot read journal, account-linked, supplier or general-library documents.
- Uploads go to `pending/firms/<firm>/documents/<id>.<type>`. Confirmation checks byte count, MIME type and file signature. PDFs are conditionally copied to `firms/<firm>/documents/<id>.<type>`; images are decoded and re-encoded as JPEG with a separate private thumbnail.
- Documents are hidden until confirmation. Retrying confirmation is idempotent. Still-valid upload URLs cannot overwrite a confirmed file. Deletion removes the object and hides its metadata without deleting the accounting entry.
- File-signature validation is not antivirus scanning. Add malware scanning and an organizational retention policy before accepting documents from untrusted external submitters.
- Arrange backups of both PostgreSQL metadata and the bucket. A database backup
  alone does not contain the images, and no full backup automation is supplied.
  [Financial JSON exports](19-backup-recovery.md) include attachment metadata only;
  see [manual recovery responsibilities](20-manual-recovery.md).

## Manual Checks

After filling the real credentials, verify on your phone: create an expense with a camera photo, open it from Documents, share/save it, restart the app and reopen it. Repeat with a PDF from Files. Turn the network off during a transfer, restore it and retry from the saved entry. Live R2 access and physical-device permission/share sheets require this final check.

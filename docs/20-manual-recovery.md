# 20. Manual Recovery Responsibilities

[Documentation index](README.md)

The repository does not provide automated full backups, offsite delivery,
retention, isolated restore, a complete identity re-enrolment workflow or binary
reattachment tools.
Assign an owner to arrange and verify recovery before using real business books.

- Back up PostgreSQL and private document storage separately, including original
  files and thumbnails. Record compatible application and migration versions.
- Keep independent private copies, protect access and encryption keys, and define
  retention, acceptable data loss and a recovery-time target.
- Restore into isolated targets and verify balances, stock, issued documents,
  attachments and authorized access before allowing clients to reconnect.
- Arrange authentication recovery and review access explicitly. Do not assume
  a financial export can recreate users, credentials or sessions.

The in-app [financial JSON export](19-backup-recovery.md) supports owner-confirmed
recovery into a new firm on a working original system. It includes attachment
metadata, not file bytes, and does not replace database or object-storage backups.
Missing attachment placeholders are not recovered files; no binary reattachment
command is supplied. The worker's scheduled jobs do not create backups.

`APP_MODE=recovery` exposes health checks and
`POST /v1/recovery-operations/redeem`, without normal sessions or business routes.
Redemption requires an existing unexpired, single-use identity ticket; it does
not issue tickets or sign the user in. No ticket-issuance command is supplied,
so this endpoint alone is not an authentication recovery procedure.

## Pending Saves Before Reconnection

Keep devices with unresolved writes disconnected while reviewing a restored
database. A restore can lose a committed entry or its operation receipt. Preserve
the original request, key and any attachment copies, and compare server receipts
and books before deciding what to do. A missing receipt after data loss is not
proof that an entry was never posted; issuing a new key can create a duplicate.

There is no supplied automated cutover or unresolved-save quarantine. Coordinate
client reconnection manually. See [offline books](17-offline-books.md) and
[attachment recovery](18-attachment-recovery.md) for local retention and retry limits.

# 17. Offline Books (View-Only)

[Documentation index](README.md) | [Offline, RBAC and real-time design](33-offline-rbac-realtime.md)

Offline mode is **view-only**. With no connection the app shows downloaded books
from an encrypted cache; creating or changing an entry needs a connection, so
nothing is saved on the device to be sent later and there is nothing to sync or
merge. Check behavior on the intended devices before relying on it for business use.

## Workflow

- `/settings/offline-books` is available to an authenticated, unlocked user with
  an active firm. While the API can't be reached the book layout shows
  **Offline - view only**.
- **Download books** fetches real API answers for every book screen the role may
  see: firm and invoice settings, units, parties and their details, items and
  their details where permitted, stock lots (today's and undated), cash/bank,
  accounts, inventory adjustments, vouchers with details and returnable lines,
  invoice/order lists, banking entries, standard reports in all/GST/non-GST scopes
  (P&L for This month, Last month, Last 3 months and This FY), GST months with
  GSTR-1/3B, composition quarters, notifications, audit log, team, reminders, book
  controls, opening allocations, last year's year-end review, loans, settlements
  and associates. Reads a role may not see are skipped.
- The download sends reads issued together to `POST /v1/reads/batch` in groups of
  up to 200. Each path runs through its normal route on the server (same
  authentication, role checks, validation and response) and the firm's books are
  read once per batch; a batch counts once against the rate limit. A firm with
  hundreds of records downloads in a handful of requests, and the encrypted cache
  is written once at the end. A server without batches is read one path at a time.
- Successful normal GETs in the offline-readable paths are cached too
  (`OFFLINE_READABLE_PATH` in `packages/contracts/src/reads.ts`, shared with the
  batch endpoint). Reads are keyed by exact path and sorted query parameters; an
  unvisited filter or date range shows **You're offline** rather than invented data.
- Documents, account sessions/invitations and backup need a connection and say so.
- **Saving:** every save first reaches the server (an original-key lookup). Offline,
  it is refused before anything is kept: *"You're offline. You need to be online to
  create or update an entry."* The form stays filled in to save again later.
- Online, a save is sent at once. If the connection drops after the server received
  it, the entry is kept under its key and the form asks you to check it in Offline
  books. Background sync (reconnect, app activation, a 30-second timer) only asks
  the server for the original answer and **never posts**; **Check and save now** or
  saving the same form again sends it explicitly under the same key, so it can't be
  duplicated.
- A definitive server rejection shows the submitted values, the server's record and
  field errors. Discard it, or save an edited replacement (sent at once, online).
- Reads the server rate-limits (429) wait for its `Retry-After` (at most 30 s) and
  retry up to three times; writes are never repeated automatically.

## Saving Needs a Connection

Every create and update, including sales, purchases, receipts, payments, expenses,
journals, contras, returns, orders, delivery notes, masters and inventory
adjustments, is posted by the server's normal domain services the moment it is
saved. There is no offline outbox of new work. The retained-entry machinery below
exists only for saves whose reply was lost, for entries kept by earlier app
versions, and for review after a server restore.

## Persistence And Access

- Cache/outbox keys include user ID, firm ID and original role. A live identity
  also includes membership scope, session revision and lock/auth state. Queued
  writes never transfer to another account, firm or role.
- Offline restoration requires the existing authenticated identity plus an
  encrypted membership grant verified online within 24 hours. A backwards clock
  or expired grant fails closed. No offline password, OTP or role elevation exists.
  Server revocation while truly disconnected cannot be discovered until reconnect;
  the short grant bounds that limitation. Every sync/reconciliation rechecks access.
- Known access revocation removes the old read cache and hides retained requests.
  Membership/role changes invalidate TanStack query and mutation scopes. Old outbox
  records and attachment copies remain until the matching authorized scope returns
  and explicitly resolves/discards them. Logout never purges them or the key.
- Native data is AES-GCM encrypted under a random key in Expo SecureStore using
  device-only accessibility. Files are derived SHA-256 names below
  `Paths.document/offline-books-v1`. Interrupted replacement retains a recoverable
  `.next` file. AAD authenticates the owner/scope key.
- Web data uses AES-GCM, a non-extractable origin-private Web Crypto key and strict
  IndexedDB transactions in `hisaab-offline-sealed-v1`. Web Locks serialize tabs.
  Unsupported secure-context/Crypto/lock environments fail closed. Same-origin
  scripts can use this key: encryption is not an XSS or hostile-device defense.
- New financial draft metadata uses the same encryption facility. Ordinary upload
  bytes/metadata remain in the private attachment store. See attachment retention
  details in [Attachment recovery](./18-attachment-recovery.md).
- Read cache size is capped at 25 MiB; pending operations are capped at 1,000.
  Storage/quota errors cannot report an unpersisted operation as queued. A failed
  cache refresh does not turn a genuine online answer into fabricated save failure.
  Download completion is recorded only after all requested reads/cache writes
  succeed online. These are timestamped authoritative answers, not a globally
  atomic database snapshot. Clearing downloaded books leaves the outbox and copies.

## Recovery After a Database Restore

The server publishes `X-Recovery-Epoch`, a UUID configured outside PostgreSQL.
The operator must change it during a restore or account/host cutover as described
in [guide 30](30-postgres-r2-backup-and-ec2-migration.md). Ordinary deployments
keep it unchanged. Deploy the matching server and client together: older servers
without this header cannot safely serve this client.

Outboxes, read caches, membership grants, pending retry keys and financial
attachment drafts retain their generation. Learning a new server generation
invalidates previous cached books and refreshes firm selection. Old in-flight
responses cannot move the observed generation backwards. A 30-second request
deadline covers both headers and body consumption; a lost or timed-out write
remains uncertain under its original key.

A changed generation, or a legacy journal whose generation cannot be established,
quarantines retained work before lookup/execution. Fresh login as the same user,
firm and role does not remove that quarantine. Clearing downloaded books does
not clear it either. Known-success operations are never automatically reposted.
When the server generation changes during a request, its old-generation result
cannot be reported as a current confirmed save.

Use **Settings → Offline books** to reconcile:

1. Keep the original device storage and attachment files. Review every retained
   request, including completed history, against the restored books with the
   owner/accountant.
2. Select **Check restored answer**. This performs only original-key lookup.
   A committed receipt must still have its matching business record; a missing
   record blocks automatic resolution. An absent receipt does not authorize replay.
3. Record what was compared and how missing or different entries will be resolved,
   then choose **Record review and keep original**. This changes only local review
   metadata. It posts/deletes no financial record and preserves request IDs,
   original responses and attachment references.
4. After every retained request has a review for this generation, choose
   **Resume new work after review**. Old pending requests become retained history
   and are never resent automatically. New work may resume and read caches are
   rebuilt. Any needed manual re-entry remains a deliberate accounting decision;
   do not reuse an old request key as a fresh transaction.
5. Reconcile retained uploads separately in **Pending uploads**. Resuming new
   books does not silently approve old upload tickets or erase image copies.

This is an explicit device-side review workflow, not proof that the accountant's
manual reconciliation is correct. Unknown historical direct retry keys that
predate outbox metadata remain blocked and preserved; do not erase storage or
invent a replacement key to bypass that uncertainty. Corrupt storage, missing
receipts and missing business rows still need operator investigation.

The native privacy cover also keeps open forms mounted while the application is
inactive or PIN-locked. A short camera/gallery handoff preserves the draft; an
expired timeout still requires the PIN. Uploading requires unlock, while a picker
callback may retain local files behind the cover. Verify camera, app-switcher
concealment and expired locks on the intended physical phone.

## Web Cold Starts

Browser builds use standard Expo export, without offline app-shell registration.
From the repository root, with the intended `EXPO_PUBLIC_API_URL` configured:

```sh
bun run --cwd apps/native export:web
```

This runs `expo export --platform web` and writes `apps/native/dist`.
New browser builds need network access to open or reload. An already loaded app
can read its existing encrypted cache and queue supported writes while offline,
subject to the access and storage limits above. Native offline behavior remains
available under those same limits; it does not depend on a browser service worker.

The exported `offline-worker.js` is only a compatibility retirement worker for
older installations. When an old registration receives it, it deletes only
`hisaab-public-shell-v1-` caches and unregisters itself. It caches no new assets,
handles no fetches and does not clear IndexedDB, saved books, queued writes or
pending attachments. Serve this file with revalidation so existing browsers can
retire the old worker when they next reach the site online.

## Browser Identity and Access

- Web identity uses encrypted IndexedDB.
  It contains no password, OTP or session cookie. A recently verified identity
  and firm membership are both required, with a 24-hour maximum offline grant.
  Backwards clocks fail closed, including already-open membership leases.
- Explicit logout persists a local logout marker, even without internet. A
  later reload does not silently sign back in using a still-valid HttpOnly
  cookie. Explicit successful sign-in/verification activates a new generation;
  cross-tab events hide the old view, and late responses cannot rewrite another
  generation's saved identity. Missing markers still allow normal online
  validation, so an existing cookie-only installation can upgrade normally.
- Browser `online` events reverify firm access and trigger ordered foreground
  synchronization. A server 401/403 never replays through cached authorization;
  retained requests stay recoverable after the correct account signs in again.
  A definite 401 from firm/book APIs ends local access immediately, without
  depending on another `/v1/me` request that might be offline or unavailable.
- Invalid encryption keys fail with an actionable error without erasing retained
  entries. Use a real persistent browser profile for restart acceptance. A
  Playwright JSON `storageState` containing IndexedDB does **not** faithfully
  round-trip the non-extractable CryptoKey; do not treat that copy as a backup.
- Missing, blocked or corrupt IndexedDB is fail-closed for web authentication,
  including online login. The login screen shows the storage error; there is no
  plaintext fallback or bypass of the persisted logout marker. Restore this
  site's storage access in the original browser profile, then retry. Pending
  requests and keys are never automatically deleted or replaced to repair storage.
  If storage becomes unwritable during logout, the current view is hidden and an
  explicit warning says that durable local logout could not be saved. Close all
  Hisaab tabs and resolve that warning before sharing the device; online server
  logout is still attempted, but offline server revocation cannot be promised.

These are offline grants, not proof of an unexpired remote session while entirely
disconnected. Server expiry/revocation is checked on reconnect. The app must be
open for synchronization; no background OS execution or offline file transfer is
claimed. Browsers can evict site storage, so this remains a working cache/outbox,
not a substitute for a server backup.

## Server Receipts

`POST /v1/operations/:key` accepts `{ method, path, body, role, expectedVersion?,
legacy? }`. `/lookup` has the same body and is read-only; `/cancel` records an
atomic cancellation if no answer exists. Results are `committed`, `conflict`,
`cancelled`, `absent` (lookup only) or `unknown` (legacy result not retained).

The repository obtains the existing firm advisory lock, rechecks membership and
role, and executes the original domain writer within a nested transaction/savepoint.
**All apply writes roll back before a definitive 400/404/409/422 conflict receipt
is inserted.** Internal/auth/transient failures roll back the outer transaction
without a false rejection receipt. Receipt plus successful business writes commit
together. Lookup of a conflict refreshes only its comparison record, not the
original receipt or attempted version. Responses are private/no-store.

`operation_receipts` is keyed by user/key; current receipts also bind firm, role,
method/path, normalized body and expected version. It is not subject to seven-day
shared-idempotency cleanup. `0025_durable_retry_answers.sql` extends the archive
introduced in 0022 to every remaining saved answer, including settlements and
legacy sync envelopes. Shared writers consult permanent receipts and create them
in the same transaction as the business change. Cleanup only removes cache rows
with matching committed permanent receipts. Fingerprints establish the original
firm for legacy rows.

Pending key provenance survives upgrade. A legacy answer already purged before
migration is **unknown**, never assumed absent. It cannot be safely reposted,
cancelled as never executed or replaced automatically. No system can reconstruct
an erased answer by inventing another operation key.

New direct requests use UUIDv7; existing pending UUIDv4 keys remain unchanged.
An unknown old direct/sync key returns `RETRY_RESULT_UNKNOWN`. Session/access
failures and unknown/key-reuse errors retain the pending key. Modern `/operations`
requests still use their existing durable protocol, including UUIDv4 keys. Update
the server and apply migration 0025 before sending requests from the new client;
see the F01 rollout steps in [the audit](27-private-readiness-audit.md).

Confirmed background synchronization releases the matching ordinary pending-write
key only after attachment receipt/binding work succeeds. It never removes a newer
key, and a later legitimate save with identical values can start a new operation.

`POST /v1/operations/:key/document-reservation` accepts the original UploadRequest
and looks up its original ID without creating or deleting a reservation. Existing
document access checks and renewal/confirmation endpoints enforce current access
and tombstones. Unknown/deleted results never create a replacement document.

## Integration

1. `apps/api/src/app.ts` registers `operationRoutes` from
   `apps/api/src/modules/operations/operations.routes.ts` under `/v1` with `{ db }`,
   after the auth and firm plugins.
2. `operationReceipts` is exported through the shared schema barrel from
   `packages/backend/src/db/schema/operations.ts`. Apply pending migrations from
   `apps/api/src/db/migrations`, including `0025_durable_retry_answers.sql`, after
   a verified backup and a pause in writes.
3. Keep DataProvider's transport order: raw authenticated API -> offline books ->
   `withPendingWrites(..., durableOperations=true)` -> existing remote services.
   Preserve its access verification, before-execute copy check and confirmed-result
   attachment callback. Shared Services/remoteServices interfaces need no new
   outbox service. Inventory remains the existing optional inventory service.
4. `/settings/offline-books` is available to all authenticated active-firm members.
   That screen shows connection, cached-answer, pending-save and recovery-review
   status. Shared screens show a persistent link when saves or recovery need
   attention; the short save notification also works on web. A form that queued a
   save stays tied to that request, even after background sync finishes. Review
   the original result in Offline books and close the form before starting a new
   entry. `/settings/pending-uploads` is the attachment management route.
5. Body objects bound by `useFinancialAttachments.save` must reach the client
   unchanged. Validate without replacing the object so attachment bindings remain intact.
6. Keep local protocol hints inside the offline adapter. `x-hisaab-pending-key`,
   `x-hisaab-legacy-operation` and `x-hisaab-attachment-draft` are removed on
   online-only passthrough routes, including backup inspection and report exports.
   Do not add them to API CORS allowances. Genuine version/firm/idempotency headers
   and the original body identity remain unchanged.
7. Forward and expose `X-Recovery-Epoch` through API CORS/proxies. Preserve each
   operation's original epoch; never substitute the current server value to make
   an old retry pass. Generation reset and operator cutover belong to guide 30.

## Manual Checks

Use staging books and a persistent browser profile or intended device. Cache the
required views, go offline and create a supported entry. In a browser, keep the
app loaded while offline, then reconnect before testing reload and recovery.
On native devices, also test a full restart while offline within the access grant.
Confirm ordered replay, the original response for a lost reply, and explicit
review of conflicts without duplicate financial entries.

Check user/firm switching, sign-out, access revocation and expired grants. Confirm
unavailable cached views report that state and corrupt storage is retained for
reconciliation. Check process restart and low-storage behavior on Android/iOS.

During a controlled restore, keep devices paused until the new server epoch and
restore checks are accepted. Test automatic quarantine, fresh login, an uncertain
save, known-success history, interrupted responses and the explicit review flow.
Follow [manual reconnection responsibilities](20-manual-recovery.md#pending-saves-before-reconnection)
before resuming new work. Attachment recovery has separate
[binding and retention limits](18-attachment-recovery.md).

# 18. Attachment Recovery

[Documentation index](README.md)

Pending uploads manages **local attachment** copies and preserves financial saves
for the supported forms below. It integrates with the encrypted, ordered financial
outbox and durable server receipts described in [Offline books](./17-offline-books.md).
Local discard does not delete business database/R2 data.

## Implemented

- `/settings/pending-uploads` enumerates voucher, account and library queues in
  the current user/firm scope. It shows file names, sizes, links, transfer state,
  durable last failures, missing copies and confirmed copies awaiting cleanup.
- Per-file and selected-batch retries use the existing document service and
  original metadata/reservation key. They never call a financial create route.
  A library selection without saved upload details opens its existing form.
- Open-original actions use `/voucher/[id]`, `/account/[key]` and
  `/settings/documents`. Router params preserve account keys containing slashes.
- Per-file and batch discard ask for explicit confirmation. The batch is a
  snapshot of selected IDs; newly staged files are excluded. Entry-level
  pending-copy removal also asks for confirmation.
- Listing is read-only. Missing copies and failed removals remain visible.
  Confirmed local copies have a separate cleanup action; existing entry
  restoration also retries cleanup from the durable confirmation receipt.
- Discard, upload, metadata updates and cleanup use the same scope lock. Discard
  queued behind an upload re-reads the record and skips a newly confirmed file.
  Account/firm/access/session changes invalidate waiting user actions.
- Upload reads the current app-owned copy under that lock instead of trusting
  an old preview URI. A missing copy cannot create a fresh server reservation.
  A known uploaded document can still be confirmed without local bytes. Web
  metadata/confirmation writes remain possible when its blob is lost.
- Failures and reservation-attempt times survive restart. New records persist
  the first-attempt marker before the initial ticket request. Progress and
  completion receipts are saved before proceeding or cleaning up.
- Financial forms with selected files preserve an immutable request, original
  role, stable operation key and all app-owned copies **before** financial POST.
  Retained unbound drafts appear separately in Pending uploads. Recovery of an
  unknown save requires explicit confirmation and uses only that original
  body/key; ordinary file retry never posts a financial entry.

## Explicit retention policy

Sign-out, forced logout, app lock, account switching, firm switching and role
changes do **not** erase pending attachments. No age-based local deletion runs.
Only the matching signed-in account in the matching active firm can explicitly
discard pending copies. Returning to that scope restores them. Successful
confirmation permits removal of that file's local recovery copy and receipt.
After a server recovery-epoch change, even a locally confirmed copy is retained
until its original reservation is checked against the restored server.

Discard removes only the app-owned recovery copy and metadata. It never deletes
camera/gallery originals, picker source files, financial records, or confirmed
server documents. It makes no server DELETE request. Pending server reservations
and abandoned staging objects may outlive local discard; server reconciliation
remains separate work.

New financial draft manifests use authenticated AES-GCM encryption, including
the request body and confirmed answer. Native keys are device-only SecureStore
keys; web keys are non-extractable Web Crypto keys in origin-private IndexedDB.
Existing plaintext manifests remain readable and become encrypted on their next
write. File bytes and ordinary upload metadata/temporary URLs remain in the
app's private directory/browser origin. This is not protection against a
compromised device, same-origin script or XSS. Clearing browser data, losing the
key, uninstalling the app or OS storage loss can remove recovery capability.
This screen is not cross-device recovery.

On view/auth changes, preview URLs are released and UI state is hidden. Session
revision and membership access changes stop subsequent requests. An already
running signed PUT cannot be recalled; its result stays bound to its original
owner/document. A confirmation received after a scope change may still record
its receipt for that original owner, preventing replay.

Financial drafts also require the same original role and its current permission
for that operation. A role change hides the draft until that role is restored;
it does not erase it. An unsent draft can be explicitly discarded as a whole.
An attempted draft with an unknown financial result cannot simply be discarded.
Recover its answer first, or explicitly cancel it in Offline books. Cancellation
under the server's firm lock returns an existing commit or records a permanent
cancellation tombstone. Only a definitive rejection/cancellation permits local
unbound-copy discard. No financial entry is cancelled by a copy-discard action.

## Storage boundaries

Native storage remains
`Paths.document/attachment-recovery-v1/<SHA-256 scope hash>/<UUID>/`. Only paths
constructed from the fixed root, hash and validated UUID are removed. Bytes are
size-checked. `record.next` survives interruption while replacing `record.json`.
Discovery verifies metadata against its actual directory. Stable draft binding
IDs can resume an unpublished copy after interruption before metadata was
written; existing published records are never overwritten with another source.

Enumeration preserves directories without manifests. Unknown,
unattributable or corrupt manifests/copies are retained, not guessed into an
owner's purge. Such records cannot all be shown by this screen; repairing
orphaned local files needs separate owner-attribution/reconciliation. A corrupt
record in a known scope produces a read failure rather than empty success.
There is no global storage sweep.

Web uses the existing `hisaab-attachment-recovery-v1` IndexedDB database.
Discovery reads distinct scope index keys without loading every user's blobs.
Strict read/write transactions persist metadata and bytes together. Web Locks
serialize across tabs. Browsers without Web Locks fail closed for queue
operations. Reads/writes normalize records through the schema, including document
metadata ordering.

### Stale reservations

The API retains permanent write answers; the shared cache can expire after
seven days only when its permanent answer exists. Historical requests may have
lost their answers before this protection was added. The client reconciles an unknown reservation
after six days (one-day margin), or if the clock moved before its first-attempt
timestamp. Legacy records without both the new reservation marker and a known
document ID are also blocked: the client cannot prove they were never sent.
The UI requests reconciliation and retains the copy and key.

Stale/legacy attempts call the read-only
`POST /v1/operations/:key/document-reservation` endpoint before any new reservation.
`apps/api/src/db/migrations/0025_durable_retry_answers.sql` extends the original
archive to compact `{ documentId }` answers as well as historical full tickets,
independently of the shared-key TTL, and backfills remaining answers. Lookup verifies the original
user, firm, request fingerprint and current document access. It returns only the
original ID, not an old signed URL. Existing renewal and confirmation routes
decide whether that document remains pending, confirmed, deleted or inaccessible.
Removed/unauthorized documents are never recreated. A confirmed result can finish
without local bytes. Unknown answers already purged before migration remain
unrecoverable automatically; copies and keys are retained, with an explicit error.

## Integration and access

1. The Settings row and form recovery notices use `/settings/pending-uploads`,
   which includes retained financial drafts.
2. Allow any signed-in user with an active firm to reach their own local queue,
   including sales/accountant roles; do not gate solely on `can(role, "settings")`.
   The screen blocks signed-out, locked and demo sessions. Retry APIs and
   original-entry pages retain current permissions. Removed membership with no
   active firm cannot expose its retained queue.
3. Keep AuthProvider, DataProvider and QueryClientProvider available. Existing
   `useAddDocument` invalidates document caches. The financial draft panel uses
   the exported `useRefreshAll` to refresh recovered entries.
   Keep the DataProvider transport wrapped with `withPendingWrites`.
   DataProvider installs the offline transport inside `withPendingWrites` and
   supplies receipt reconciliation/binding callbacks. `apps/api/src/app.ts`
   registers `operationRoutes` under `/v1`; `operationReceipts` is exported from
   `packages/backend/src/db/schema/operations.ts`. Apply pending API migrations
   before enabling this client. The Services aggregate remains the ordinary sender.
4. Preserve retention in logout/account-deletion cleanup: do not delete the
   recovery directory, its IndexedDB database or all user-scoped local data.
   The screen states the policy; erasure uses confirmed discard. There is
   intentionally no `clearAllAttachments` logout hook.
5. Native logout locks immediately while durable logout finishes. PIN/privacy
   concealment keeps forms mounted, but uploads remain blocked while locked.
   Account/firm/access/session changes still invalidate attachment callbacks.
   Browser network logout remains bounded by the API deadline before durable
   local logout; do not share the device until logout has completed.

The canonical library routes use `LibraryDocumentForm`. `pendingWrites.ts`, the
client body-preservation boundary and `voucherServices.ts` implement lifecycle
callbacks and explicit original-key forwarding. No shared query rewrite is needed.

## Financial save/stage lifecycle

These forms stage attachment copies before saving **new entries with selected
files**:

- `InvoiceForm`: sales (including mixed GST/non-GST), purchases, estimates,
  sales orders, purchase orders and delivery notes.
- `MoneyForm`: receipts and payments.
- Contra, expense, journal, financing journal, credit note and debit note forms.
- Custom account and cash/bank account creation in `app/account/new.tsx`.
- Inventory adjustment creation at `/inventory/adjustments`, returning a journal
  voucher. The inventory client validates without cloning the bound body.

These forms use `useFinancialAttachments().save(path, input, send, expectedCount)`.
The ordinary mutation remains the sender; queries must pass the same body
object through unchanged. Account creation uses `useFinancialAttachments(undefined,
"account")`. The outer operation envelope adds durable receipt semantics without
adding fields to financial/master business inputs.

The implemented transport contract in `pendingWrites.ts` is:

```ts
interface PendingWriteLifecycle {
  key: string;
  userId: string;
  firmId: string;
  path: string;
  legacy?: boolean;
  recoveryEpoch?: string;
  previouslyAttempted?: boolean;
  assertActive(): void;
  beforeSend(): Promise<void>;
  afterValidatedResponse(response: unknown): Promise<void>;
}
```

`bindPendingWrite(body, lifecycle)` carries these callbacks in a runtime WeakMap,
not in the API body. `voucherServices` forwards the draft's original key.
`withPendingWrites` checks the account, firm and path, awaits the attempt
checkpoint before transport, then awaits the validated-response checkpoint
before clearing its pending key. A receipt-storage failure throws a distinct
`ConfirmedWriteError`; the helper returns a saved-with-recovery warning, not an
unsaved-entry result. Managed keys remain retained even after a 4xx, since a
permission failure during replay is not proof the original request never saved.

### Draft and binding checkpoints

1. `createAttachmentDrafts.prepare` JSON-normalizes the exact body and records
   original owner/firm/role, method-specific path, binding policy, file metadata,
   creation time and stable UUIDs. The first file's record is also the manifest.
   `ready` becomes true only after every selected file has a durable private copy.
   Partial preparation is retained for explicit discard; it never posts.
2. `submit` verifies readiness and every copy, and stamps `firstAttemptAt` before
   transport. A duplicate equivalent retained request cannot start with a new
   draft key. A mounted form also refuses a second save of its retained draft.
3. `afterValidatedResponse` stores the full original answer and stable per-file,
   per-voucher destination IDs in one manifest update, including when logout
   occurs while the response arrives. Recovery uses that receipt without any
   financial request once it exists.
4. Destinations start as `bindingPending`; upload/discard cannot touch them.
   The manifest's release checkpoint is persisted **before** exposing each
   destination. Recovery never recreates an absent released copy, which may
   already have been uploaded or explicitly discarded in another view/tab.
   Missing unpublished destinations can be rebuilt from retained draft bytes.
5. Source copies are removed only after publication, with the manifest removed
   last. An interrupted cleanup resumes locally without publishing duplicates.
   Draft and destination scope locks serialize concurrent recovery and uploads.

Mixed sales explicitly bind **every selected file to both returned invoices**,
matching the previous form behavior. The confirmation names that choice. The
durable plan expects two distinct sale IDs, one GST and one non-GST. Other
operations expect one matching voucher type or the validated account/ledger
answer. Account destinations use `account:<id>` / `ledger:<id>`. Unexpected counts/types/scopes or
an incomplete binding plan keep the saved receipt and draft for reconciliation;
they do not guess destinations or post again. Paid-now receipts created inside
the financial transaction are not attachment destinations.

Existing invoice edits have a known voucher ID: selection stages copies to that
entry before the update. Those photos remain linked to the original entry even
if the edit fails. Recovery never repeats the invoice PUT.

### Unknown financial responses

New outbox drafts persist `receiptProtocol: operations-v1`; new direct drafts use
`durable-retries-v1` and UUIDv7 IDs. Existing IDs and provenance are never rewritten.
The outbox writes its original
key/body/version before contacting the API. Recovery first uses read-only
`POST /v1/operations/:key/lookup`. A committed answer binds locally, including when
copies are missing (the binding failure remains visible). Within the **same
recovery epoch**, an absent new-protocol receipt permits the original key to
execute once, after copy checks. Conflict,
cancelled and unknown answers never trigger a blind financial POST. Background
sync rechecks attempted draft copies before executing an absent operation and
does not hold an outbox lock while acquiring a draft lock for binding.

Durable operation receipts have no shared-idempotency TTL. Legacy attempts carry
legacy provenance; a missing retained legacy answer is not proof of absence and
cannot be reposted or rekeyed. The older six-day financial guard remains for
historical drafts without either durable protocol. Only a definitive conflict can be explicitly edited into
a new request in Offline books. Its original attachment binding plan is retained;
unexpected split counts still fail closed instead of guessing destinations.

### Restored-server reconciliation

Financial drafts and ordinary upload records retain the server recovery epoch
alongside the original key. A new server generation blocks old attempts and
signed-upload progress. Fresh login cannot silently relabel them. No old
confirmed copy is automatically cleaned merely because a pre-restore receipt
exists on this device.

- Resolve the book outbox using **Offline books → Check restored answer → Record
  review and keep original**, then resume new work only after the accounting
  comparison. See [guide 17](17-offline-books.md#recovery-after-a-database-restore).
- For a retained financial draft, **Check original save** uses the original
  request/key and verifies that a committed receipt still has its matching
  business record. A different saved answer, an absent/unknown receipt or a
  missing row keeps the draft and files blocked. It does not create another bill.
  Matching receipts can finish the original local binding plan.
- For an ordinary pending or locally confirmed image, use **Check restored
  reservation**. The lookup must return the original document ID; renewal or
  confirmation then targets only that document. No replacement reservation is
  created. A missing/deleted/unauthorized answer keeps the copy for investigation.
- A copy explicitly marked as never attempted can be adopted into the current
  generation after this user action. An ambiguous legacy record cannot claim
  that exemption. Financial target validation still applies on upload.
- After verification, retry the existing upload or clean its confirmed local
  copy. Checking a reservation is not an independent verification of every R2
  object's bytes; the full restore drill in guide 30 covers original/thumbnail
  integrity and missing server objects.

Missing financial receipts may require manual accounting reconciliation and
re-entry. Retained immutable drafts do not offer arbitrary voucher-ID reassignment.
Preserve their bytes and original identities until that investigation is complete;
do not clear browser storage, reinstall or discard an uncertain attempted draft
to bypass the protection.

### Recovery limits

- Receipts purged before migration, lost encryption keys and lost original bytes
  cannot be reconstructed from a new key or inferred from similar entries.
- Corrupt/unattributable local storage and unexpected saved binding plans need
  reconciliation, not destructive automatic cleanup. There is no arbitrary
  manual voucher-ID reassignment, per-file editing of an immutable unbound draft,
  cross-device recovery or automatic R2 orphan deletion. Device-only storage is
  not an independent backup. Unexpected binding plans remain visible for review.

## Manual Checks

On staging, save an entry with attachments, interrupt a transfer and reopen the
app. Confirm pending uploads retain their original entry binding and retry
without repeating the financial save. Review lost-response and conflict states
before replacing or discarding an operation.

Check sign-out, firm switching and access revocation without exposing another
user's files. On intended devices, check camera/gallery, restart, low-storage
behavior and readable downloads. Device-local storage is not an independent backup.

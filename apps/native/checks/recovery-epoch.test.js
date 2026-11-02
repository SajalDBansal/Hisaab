import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { newRequestId } from "@repo/contracts";
import {
  createRecoveryEpoch,
  serverRecovery,
} from "../src/data/recoveryEpoch.ts";
import { createOfflineBooks } from "../src/data/offlineBooks.ts";
import { offlineKey } from "../src/data/offlineOperation.ts";
import { withPendingWrites } from "../src/data/pendingWrites.ts";
import {
  createAttachmentQueue,
  attachmentScopeKey,
} from "../src/data/attachmentRecovery.ts";
import { createAttachmentDrafts } from "../src/data/attachmentDrafts.ts";
import { recoverUpload } from "../src/data/recoverUpload.ts";
import { requestApi } from "../src/auth/apiRequest.ts";
import { ApiFailure } from "../src/auth/apiFailure.ts";
import { createPendingForm } from "../src/data/pendingForm.ts";

const a = "00000000-0000-4000-8000-000000000010",
  b = "00000000-0000-4000-8000-000000000020";
const scope = { userId: "fixture-user", firmId: "fixture-firm", role: "owner" };
const body = {
  name: "Fixture customer",
  type: "customer",
  phone: "",
  city: "Agra",
  stateCode: "09",
  gstin: "",
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
};
const operation = { method: "POST", path: "/parties", body, role: "owner" };
const response = {
  ...body,
  id: "00000000-0000-4000-8000-000000000030",
  openingDate: "2026-04-01",
  balance: 0,
  version: 1,
};
const committed = { state: "committed", response };

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
    lock: async (_key, work) => work(),
  };
}
function fixture(store = memoryStore()) {
  let epoch = a;
  const calls = [];
  let answer = { state: "absent" };
  let execute = async () => committed;
  const options = {
    scope,
    store,
    newId: randomUUID,
    recoveryEpoch: () => epoch,
    assertActive: () => {},
    verifyAccess: async () => {},
    transport: async (path, input = {}) => {
      calls.push({ path, input });
      if (path.includes("/parties/")) return { party: response };
      if (path.endsWith("/lookup")) return answer;
      return execute(path, input);
    },
  };
  return {
    store,
    calls,
    options,
    books: () => createOfflineBooks(options),
    restore: () => {
      epoch = b;
    },
    answer: (value) => {
      answer = value;
    },
    execute: (work) => {
      execute = work;
    },
  };
}

test("server observations fence late responses and reject missing/invalid epoch headers", () => {
  const state = createRecoveryEpoch(),
    initial = state.snapshot();
  assert.throws(() => state.observe(null), { code: "RECOVERY_REQUIRED" });
  assert.throws(() => state.observe("not-an-epoch"), {
    code: "RECOVERY_REQUIRED",
  });
  state.observe(a, initial);
  const oldRequest = state.snapshot();
  state.observe(b, state.snapshot());
  assert.throws(() => state.observe(a, oldRequest), {
    code: "RECOVERY_REQUIRED",
  });
  assert.equal(state.current(), b);
  assert.throws(() => state.restore(a), { code: "RECOVERY_REQUIRED" });
});

test("a queued form cannot create another operation after background sync succeeds", async () => {
  const f = fixture(),
    books = f.books(),
    submit = createPendingForm(),
    key = newRequestId(randomUUID());
  f.execute(async () => {
    throw new ApiFailure(0, "OFFLINE", "fixture disconnected");
  });
  await assert.rejects(
    submit(() =>
      books.transport("/v1/parties", {
        body,
        headers: { "idempotency-key": key, "x-firm-id": scope.firmId },
      }),
    ),
    (error) => error.pending && error.key === key,
  );
  f.execute(async () => committed);
  await books.sync();
  assert.equal(books.getSnapshot().entries[0].state, "committed");
  f.calls.length = 0;
  await assert.rejects(
    submit(() =>
      books.transport("/v1/parties", {
        body,
        headers: {
          "idempotency-key": newRequestId(randomUUID()),
          "x-firm-id": scope.firmId,
        },
      }),
    ),
    (error) => error.pending && error.key === key,
  );
  assert.equal(f.calls.length, 0);
  const correctedForm = createPendingForm();
  await assert.rejects(
    correctedForm(() => Promise.reject(new Error("validation failed"))),
  );
  assert.equal(
    await correctedForm(() => Promise.resolve("corrected")),
    "corrected",
  );
});

test("uncertain operations remain quarantined after restore and a fresh login", async () => {
  const f = fixture(),
    key = newRequestId(randomUUID());
  const original = f.books();
  f.execute(async () => {
    throw new ApiFailure(0, "OFFLINE", "reply lost");
  });
  await original.enqueue(key, operation, true);
  await assert.rejects(original.sync());
  assert.equal(original.getSnapshot().entries[0].state, "unknown");
  f.restore();
  f.calls.length = 0;
  const signedInAgain = f.books();
  await assert.rejects(signedInAgain.sync(), { code: "RECOVERY_REQUIRED" });
  assert.equal(f.calls.length, 0);
  const entry = signedInAgain.getSnapshot().entries[0];
  assert.equal(entry.key, key);
  assert.equal(entry.recoveryEpoch, a);
  assert.equal(entry.attachmentDraft, true);
  assert.deepEqual(entry.request.body, body);
  await signedInAgain.clearReads();
  await assert.rejects(f.books().sync(), { code: "RECOVERY_REQUIRED" });
});

test("manual review keeps absent requests without replay and permits only new work", async () => {
  const f = fixture(),
    books = f.books(),
    key = newRequestId(randomUUID());
  await books.enqueue(key, operation);
  f.restore();
  await assert.rejects(books.sync(), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(books.finishRecovery(), /Review every retained/);
  await assert.rejects(
    books.reviewRecovery(key, "Checked manually"),
    /Check this original answer/,
  );
  await books.inspectRecovery(key);
  assert.equal(f.calls.at(-1).input.headers["x-recovery-epoch"], b);
  await assert.rejects(books.reviewRecovery(key, "yes"), /at least 10/);
  await books.reviewRecovery(
    key,
    "Compared original invoice and kept for accountant reconciliation.",
  );
  await books.finishRecovery();
  f.calls.length = 0;
  await books.sync();
  assert.equal(f.calls.length, 0);
  assert.equal(books.getSnapshot().entries[0].state, "retained");
  await assert.rejects(books.enqueue(key, operation), {
    code: "RECOVERY_REQUIRED",
  });
  const fresh = newRequestId(randomUUID());
  await books.enqueue(fresh, {
    ...operation,
    body: { ...body, name: "New customer" },
  });
  await books.sync();
  assert.equal(
    f.calls.filter((call) => !call.path.endsWith("lookup")).length,
    1,
  );
  assert(f.calls.every((call) => call.input.headers["x-recovery-epoch"] === b));
});

test("known completed history is preserved and never resent or rebound after restore", async () => {
  const f = fixture(),
    key = newRequestId(randomUUID());
  let confirmations = 0;
  f.options.confirmed = async () => {
    confirmations++;
  };
  const books = f.books();
  await books.enqueue(key, operation);
  await books.sync();
  const original = books.getSnapshot().entries[0].result;
  f.restore();
  confirmations = 0;
  f.calls.length = 0;
  await assert.rejects(books.sync());
  await books.inspectRecovery(key);
  await books.reviewRecovery(
    key,
    "Local success is newer than restore; owner has reconciled the missing entry.",
  );
  await books.finishRecovery();
  f.calls.length = 0;
  await books.sync();
  assert.deepEqual(books.getSnapshot().entries[0].result, original);
  assert.equal(confirmations, 0);
  assert.equal(f.calls.length, 0);
});

test("an epoch-less legacy journal is quarantined without looking up or sending writes", async () => {
  const f = fixture();
  f.store.data.set(
    offlineKey(scope, "outbox"),
    JSON.stringify({
      version: 1,
      scope,
      entries: [
        {
          key: newRequestId(randomUUID()),
          request: operation,
          state: "queued",
          createdAt: 1,
        },
      ],
    }),
  );
  const books = f.books();
  await assert.rejects(books.sync(), { code: "RECOVERY_REQUIRED" });
  assert.equal(f.calls.length, 0);
  assert.equal(books.getSnapshot().quarantine.previous, undefined);
});

test("a request started before restoration cannot become a current confirmed save", async () => {
  const f = fixture(),
    books = f.books();
  f.execute(async () => {
    f.restore();
    return committed;
  });
  await books.enqueue(newRequestId(randomUUID()), operation);
  await assert.rejects(books.sync(), { code: "RECOVERY_REQUIRED" });
  assert.equal(books.getSnapshot().entries[0].state, "unknown");
  assert(books.getSnapshot().quarantine);
  assert(f.calls.every((call) => call.input.headers["x-recovery-epoch"] === a));
});

test("restored answers must still have their matching business record", async () => {
  const f = fixture(),
    books = f.books(),
    key = newRequestId(randomUUID());
  await books.enqueue(key, operation);
  f.restore();
  f.answer(committed);
  await assert.rejects(books.sync());
  const live = f.options.transport;
  f.options.transport = async (path, input) =>
    path.includes("/parties/") ? {} : live(path, input);
  await assert.rejects(
    books.inspectRecovery(key),
    /no matching restored record/,
  );
  assert.equal(books.getSnapshot().entries[0].recoveryLookup, undefined);
});

test("old read caches cannot be used after a new epoch is learned from interrupted headers", async () => {
  const state = createRecoveryEpoch();
  state.observe(a);
  const store = memoryStore();
  let online = true;
  const books = createOfflineBooks({
    scope,
    store,
    newId: randomUUID,
    recoveryEpoch: state.current,
    assertActive: () => {},
    verifyAccess: async () => {},
    transport: async () => {
      if (online) return { balance: 100 };
      const started = state.snapshot();
      return requestApi(
        "https://fixture.invalid",
        {},
        50,
        async () => ({
          headers: new Headers({ "x-recovery-epoch": b }),
          text: async () => {
            throw new TypeError("body lost");
          },
        }),
        (reply) =>
          state.observe(reply.headers.get("x-recovery-epoch"), started),
      );
    },
  });
  await books.transport("/v1/reports/dashboard");
  online = false;
  await assert.rejects(books.transport("/v1/reports/dashboard"));
  assert.equal(state.current(), b);
  assert.equal(store.data.has(offlineKey(scope, "reads")), false);
});

test("legacy or old-generation retry keys survive fresh wrappers and are never silently relabelled", async () => {
  for (const epoch of [undefined, a]) {
    serverRecovery.observe(b);
    const store = memoryStore(),
      key = newRequestId(randomUUID());
    store.data.set("hisaab.pending.fixture", key);
    if (epoch) store.data.set("hisaab.pending.fixture.epoch", epoch);
    let sent = 0;
    const send = withPendingWrites(
      async () => {
        sent++;
        return response;
      },
      store,
      scope.userId,
      async () => "fixture",
      randomUUID,
      true,
    );
    await assert.rejects(
      send("/v1/parties", { body, headers: { "x-firm-id": scope.firmId } }),
      { code: "RECOVERY_REQUIRED" },
    );
    assert.equal(sent, 0);
    assert.equal(store.data.get("hisaab.pending.fixture"), key);
    assert.equal(store.data.get("hisaab.pending.fixture.epoch"), epoch);
  }
});

function attachmentStore() {
  const rows = new Map();
  const key = (scope, id) => `${attachmentScopeKey(scope)}:${id}`;
  return {
    rows,
    scopes: async () => [
      ...new Map(
        [...rows.values()].map((row) => [
          attachmentScopeKey(row.scope),
          row.scope,
        ]),
      ).values(),
    ],
    list: async (scope) =>
      [...rows.values()].filter(
        (row) => attachmentScopeKey(row.scope) === attachmentScopeKey(scope),
      ),
    read: async (scope, id) => rows.get(key(scope, id)) ?? null,
    write: async (record) => {
      rows.set(key(record.scope, record.id), structuredClone(record));
    },
    open: async (record) => ({
      ...record.file,
      uri: `file://fixture/${record.id}`,
    }),
    remove: async (record) => {
      rows.delete(key(record.scope, record.id));
    },
    release: () => {},
    lock: async (_key, work) => work(),
  };
}
test("confirmed attachments retain local copies until their restored reservation is checked", async () => {
  serverRecovery.observe(a);
  const storage = attachmentStore(),
    queue = createAttachmentQueue(storage, randomUUID);
  const attachmentScope = {
    userId: scope.userId,
    firmId: scope.firmId,
    target: "voucher",
    entryId: response.id,
  };
  const files = await queue.stage(
    attachmentScope,
    [
      {
        name: "fixture.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        uri: "file://fixture.jpg",
      },
    ],
    () => {},
  );
  const row = [...storage.rows.values()][0];
  row.completed = {
    id: randomUUID(),
    name: "fixture.jpg",
    kind: "bill",
    sizeKb: 1,
    uploadedOn: "2026-10-26",
  };
  await storage.write(row);
  serverRecovery.observe(b);
  await assert.rejects(
    queue.cleanupCompleted(scope, [row], () => {}),
    { code: "RECOVERY_REQUIRED" },
  );
  await assert.rejects(queue.complete(files[0], row.completed), {
    code: "RECOVERY_REQUIRED",
  });
  assert.equal(storage.rows.size, 1);
  await queue.recover(
    scope,
    row,
    async (saved, epoch) => {
      assert.equal(saved.id, row.id);
      assert.equal(epoch, b);
      return { completed: row.completed };
    },
    () => {},
  );
  await queue.cleanupCompleted(scope, [row], () => {});
  assert.equal(storage.rows.size, 0);
});

test("missing restored upload reservations keep original IDs and never create replacements", async () => {
  const row = {
    id: randomUUID(),
    scope: { ...scope, target: "voucher", entryId: response.id },
    file: { name: "fixture.jpg", contentType: "image/jpeg", sizeBytes: 10 },
    reservation: { firstAttemptAt: 1 },
  };
  const calls = [];
  await assert.rejects(
    recoverUpload(
      row,
      async (path, options) => {
        calls.push({ path, options });
        return { state: "unknown", message: "Keep original copy" };
      },
      b,
    ),
    /Keep original copy/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/v1/operations/${row.id}/document-reservation`);
});

test("a financial attachment draft cannot repost or discard files when its restored receipt is absent", async () => {
  serverRecovery.observe(a);
  const storage = attachmentStore(),
    drafts = createAttachmentDrafts(storage, randomUUID);
  const actor = {
    userId: scope.userId,
    firmId: scope.firmId,
    role: scope.role,
  };
  const record = await drafts.prepare(
    actor,
    "/receipts",
    {
      partyId: response.id,
      date: "2026-10-26",
      amount: 100,
      mode: "cash",
      ledgerId: randomUUID(),
      allocations: [],
    },
    [
      {
        name: "bill.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        uri: "file://fixture.jpg",
      },
    ],
    1,
    () => {},
    "operations-v1",
  );
  record.draft.firstAttemptAt = 1;
  await storage.write(record);
  const count = storage.rows.size;
  serverRecovery.observe(b);
  let sent = 0;
  await assert.rejects(
    drafts.submit(
      actor,
      record,
      async () => {
        sent++;
      },
      () => {},
      async () => ({ state: "absent" }),
    ),
    { code: "RECOVERY_REQUIRED" },
  );
  assert.equal(sent, 0);
  assert.equal(storage.rows.size, count);
  assert.equal(
    (await storage.read(record.scope, record.id)).draft.recoveryEpoch,
    a,
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { newRequestId } from "@repo/contracts";
import { createOfflineBooks } from "../src/data/offlineBooks.ts";
import {
  OfflineWriteError,
  PendingOperationError,
} from "../src/data/offlineOperation.ts";
import { ApiFailure } from "../src/auth/apiFailure.ts";

const epoch = "00000000-0000-4000-8000-000000000010";
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
const response = {
  ...body,
  id: "00000000-0000-4000-8000-000000000030",
  openingDate: "2026-04-01",
  balance: 0,
  version: 1,
};
const offline = () => {
  throw new ApiFailure(0, "OFFLINE", "fixture disconnected");
};

function fixture() {
  const data = new Map();
  const calls = [];
  const state = {
    lookup: { state: "absent" },
    execute: async () => ({ state: "committed", response }),
    reads: async () => ({ ok: true }),
  };
  const books = createOfflineBooks({
    scope,
    store: {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => void data.set(key, value),
      remove: async (key) => void data.delete(key),
      lock: async (_key, work) => work(),
    },
    newId: randomUUID,
    recoveryEpoch: () => epoch,
    assertActive: () => {},
    verifyAccess: async () => {},
    transport: async (path, input = {}) => {
      calls.push(path);
      if (path.endsWith("/lookup")) {
        if (state.lookup === "offline") offline();
        return state.lookup;
      }
      if (path.startsWith("/v1/operations/")) return state.execute();
      return state.reads(path, input);
    },
  });
  const save = (key = newRequestId(randomUUID())) =>
    books.transport("/v1/parties", {
      body,
      headers: { "idempotency-key": key, "x-firm-id": scope.firmId },
    });
  return { books, calls, state, save };
}

test("offline, a save is refused and nothing is kept on the device", async () => {
  const f = fixture();
  f.state.lookup = "offline";
  await assert.rejects(
    f.save(),
    (error) =>
      error instanceof OfflineWriteError &&
      /need to be online/.test(error.message),
  );
  assert.equal(f.books.getSnapshot().entries.length, 0);
  assert(
    f.calls.every((path) => path.endsWith("/lookup")),
    "never executed",
  );
});

test("online, a save is sent at once and confirmed", async () => {
  const f = fixture();
  assert.deepEqual(await f.save(), response);
  assert.equal(f.books.getSnapshot().entries[0].state, "committed");
  assert.equal(f.calls.filter((path) => !path.endsWith("/lookup")).length, 1);
});

test("a lost reply is kept and background sync only asks for its answer", async () => {
  const f = fixture();
  f.state.execute = offline;
  const key = newRequestId(randomUUID());
  await assert.rejects(
    f.save(key),
    (error) => error instanceof PendingOperationError && error.key === key,
  );
  assert.equal(f.books.getSnapshot().entries[0].state, "unknown");

  // Not saved on the server: background sync leaves it for the user, never resends.
  f.calls.length = 0;
  await f.books.sync();
  assert(f.calls.every((path) => path.endsWith("/lookup")));
  assert.equal(f.books.getSnapshot().entries[0].state, "unknown");
  assert.match(f.books.getSnapshot().entries[0].error, /Not saved/);

  // It did reach the server: the original answer is adopted without resending.
  f.state.lookup = { state: "committed", response };
  f.calls.length = 0;
  await f.books.sync();
  assert.equal(f.books.getSnapshot().entries[0].state, "committed");
  assert(f.calls.every((path) => path.endsWith("/lookup")));
});

test("saving the same form again online resends under the same key", async () => {
  const f = fixture();
  const key = newRequestId(randomUUID());
  f.state.lookup = "offline";
  await assert.rejects(f.save(key), OfflineWriteError);
  f.state.lookup = { state: "absent" };
  assert.deepEqual(await f.save(key), response);
  assert.equal(f.books.getSnapshot().entries.length, 1);
});

test("other writes and reads while offline", async () => {
  const f = fixture();
  f.state.reads = async (path, input) => {
    if (input.method === "DELETE" || path.includes("/offline-probe")) offline();
    return { ok: true };
  };
  await assert.rejects(
    f.books.transport("/v1/documents/x", {
      method: "DELETE",
      headers: { "x-firm-id": scope.firmId },
    }),
    OfflineWriteError,
  );
});

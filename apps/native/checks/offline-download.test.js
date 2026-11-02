import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createOfflineBooks } from "../src/data/offlineBooks.ts";
import { offlineKey } from "../src/data/offlineOperation.ts";
import { ApiFailure } from "../src/auth/apiFailure.ts";

const epoch = "00000000-0000-4000-8000-000000000010";
const scope = { userId: "fixture-user", firmId: "fixture-firm", role: "owner" };

function fixture({ batches = true } = {}) {
  const data = new Map();
  const calls = [];
  let writes = 0;
  const answer = (path) => ({ path });
  const books = createOfflineBooks({
    scope,
    store: {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => {
        if (key === offlineKey(scope, "reads")) writes++;
        data.set(key, value);
      },
      remove: async (key) => void data.delete(key),
      lock: async (_key, work) => work(),
    },
    newId: randomUUID,
    recoveryEpoch: () => epoch,
    assertActive: () => {},
    verifyAccess: async () => {},
    transport: async (path, input = {}) => {
      calls.push(path);
      if (path === "/v1/reads/batch") {
        if (!batches) throw new ApiFailure(404, "NOT_FOUND", "no batches");
        return {
          results: input.body.paths.map((p) =>
            p.includes("forbidden")
              ? {
                  path: p,
                  status: 403,
                  format: "json",
                  body: { error: { code: "FORBIDDEN", message: "No." } },
                }
              : { path: p, status: 200, format: "json", body: answer(p) },
          ),
        };
      }
      return answer(path);
    },
  });
  const read = (path) =>
    books.transport(path, { headers: { "x-firm-id": scope.firmId } });
  return { books, calls, read, writes: () => writes };
}

test("a download sends reads issued together as batches and writes the cache once", async () => {
  const f = fixture();
  const paths = Array.from({ length: 450 }, (_, i) => `/v1/parties/p${i}`);
  await f.books.capture(async () => {
    const answers = await Promise.all(paths.map(f.read));
    assert.deepEqual(answers[449], { path: "/v1/parties/p449" });
  });
  assert.equal(
    f.calls.filter((p) => p === "/v1/reads/batch").length,
    3,
    "450 reads in 3 batches",
  );
  assert.equal(f.calls.filter((p) => p.startsWith("/v1/parties")).length, 0);
  assert.equal(
    f.writes(),
    2,
    "one cache write for the answers, one for the download time",
  );
});

test("a failed read inside a batch fails only that read", async () => {
  const f = fixture();
  await assert.rejects(
    f.books.capture(async () => {
      const [good, bad] = await Promise.allSettled([
        f.read("/v1/parties/a"),
        f.read("/v1/parties/forbidden"),
      ]);
      assert.equal(good.status, "fulfilled");
      assert.equal(bad.status, "rejected");
      assert.equal(bad.reason.status, 403);
      throw bad.reason;
    }),
  );
});

test("a server without batches gets the reads one by one", async () => {
  const f = fixture({ batches: false });
  await f.books.capture(async () => {
    await Promise.all(["/v1/parties/a", "/v1/parties/b"].map(f.read));
  });
  assert.deepEqual(f.calls.filter((p) => p.startsWith("/v1/parties")).sort(), [
    "/v1/parties/a",
    "/v1/parties/b",
  ]);
});

test("outside a download, reads are not batched", async () => {
  const f = fixture();
  await f.read("/v1/parties/a");
  assert.deepEqual(f.calls, ["/v1/parties/a"]);
});

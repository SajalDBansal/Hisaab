import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  ItemInput,
  ItemRow,
  OpeningStockLots,
  BackupRows,
  MAX_OPENING_STOCK_LOTS,
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import {
  listSnapshotCleanupIds,
  markDocumentCleanupBackupSafe,
  runDocumentCleanup,
} from "@repo/backend/modules/documents/cleanup";
import { buildApp } from "./app";
import { memorySender } from "./lib/email";
import { fakeStorage } from "./lib/storage";
import { exportDigest } from "./modules/backup/backup.validation";
import { IMPORT_COLUMNS } from "./modules/imports/imports.csv";
import {
  validateFinancialImport,
  type FinancialContext,
} from "./modules/imports/imports.financial.validation";

const lots = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `lot-${i}`,
    qty: 1,
    unitCost: 100,
    bookScope: "nongst" as const,
  }));
const itemInput = (name: string) => ({
  name,
  code: "",
  hsn: "",
  group: "",
  taxType: "nongst" as const,
  gstRate: 0 as const,
  unit: "Pcs",
  purchasePrice: 100,
  salePrice: 200,
  mrp: 0,
  reorderLevel: 0,
  openingStock: 0,
});

test("opening lots share one bounded, legacy-compatible input/read/restore contract", () => {
  for (const count of [200, 201, 500]) {
    const input = {
      ...itemInput("Opening goods"),
      openingStock: count,
      openingLots: lots(count),
    };
    assert.equal(ItemInput.safeParse(input).success, true);
    assert.equal(
      ItemRow.safeParse({
        ...input,
        id: randomUUID(),
        version: 1,
        stock: count,
        lowStock: false,
      }).success,
      true,
    );
    assert.equal(
      BackupRows.items
        .pick({ openingLots: true })
        .safeParse({ openingLots: lots(count) }).success,
      true,
    );
  }
  assert.equal(
    OpeningStockLots.safeParse(lots(MAX_OPENING_STOCK_LOTS + 1)).success,
    false,
  );
  assert.equal(
    OpeningStockLots.safeParse([lots(1)[0], lots(1)[0]]).success,
    false,
  );
});

test("financial validation refuses an oversized per-item import before persistence", () => {
  const itemId = randomUUID();
  const context: FinancialContext = {
    fyStart: "2026-04-01",
    today: "2026-10-26",
    defaultGst: false,
    locked: false,
    hasActivity: false,
    version: 0,
    parties: [],
    ledgers: [],
    accounts: [],
    initialized: [],
    billParties: [],
    items: [{ id: itemId, openingStock: 0, openingLots: null, version: 1 }],
  };
  const records = [
    [...IMPORT_COLUMNS["opening-stock"]],
    ...lots(501).map((_, i) =>
      IMPORT_COLUMNS["opening-stock"].map(
        (key) =>
          ({
            itemId,
            lotNumber: `batch-${i}`,
            date: context.fyStart,
            bookScope: "nongst",
            quantity: "1",
            unitCost: "1.00",
          })[key],
      ),
    ),
  ];
  const result = validateFinancialImport(
    "opening-stock",
    { records, errors: [] },
    context,
  );
  assert.equal(result.preview.canApply, false);
  assert.ok(
    result.preview.errors.some((e) => e.message.includes("500 opening lots")),
  );
});

// This suite only connects to the explicitly supplied disposable database; it never reads .env.
test(
  "A10/A11 real API, restore, rollback, backup snapshot and cleanup retries",
  {
    skip: !process.env.HISAAB_DATA_TEST_URL,
    timeout: 120_000,
  },
  async (t) => {
    const databaseUrl = process.env.HISAAB_DATA_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_data");
    const { db, pool } = createDb(url.toString(), { workload: "maintenance" });
    const mail = memorySender();
    const storage = fakeStorage();
    let apiDeleteCalls = 0;
    storage.remove = async () => {
      apiDeleteCalls++;
      throw new Error("API must not delete objects");
    };
    const app = await buildApp({
      db,
      email: mail.sender,
      storage,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET:
          "data-fixture-only-secret-not-used-by-real-accounts",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
      },
    });
    const tag = randomUUID().slice(0, 8);
    const headers = {
      origin: "http://localhost:8081",
      "x-client-platform": "web",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    };
    try {
      async function account(suffix: string) {
        const email = `data-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Data ${suffix}`,
            email,
            password: "Fixture-password-123!",
            phoneNumber: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
          },
        });
        assert.equal(signup.statusCode, 200, signup.body);
        const verify = await app.inject({
          method: "POST",
          url: "/api/auth/email-otp/verify-email",
          headers,
          payload: { email, otp: mail.lastCode(email) },
        });
        assert.equal(verify.statusCode, 200, verify.body);
        const cookies = verify.headers["set-cookie"];
        const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
          .map((c) => c.split(";")[0])
          .join("; ");
        return { cookie, id: verify.json<{ user: { id: string } }>().user.id };
      }
      const owner = await account("owner");
      const outsider = await account("outsider");
      const call = (
        method: "GET" | "POST" | "DELETE",
        path: string,
        firmId?: string,
        payload?: object,
        cookie = owner.cookie,
        extra = {},
      ) =>
        app.inject({
          method,
          url: `/v1${path}`,
          headers: {
            ...headers,
            cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...extra,
          },
          payload,
        });
      async function firm(name: string) {
        const response = await call("POST", "/firms", undefined, {
          name: `${tag} ${name}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        });
        assert.equal(response.statusCode, 201, response.body);
        return response.json<{ id: string; fyStart: string }>();
      }
      const books = await firm("Opening lots");
      async function createItem(name: string) {
        const response = await call(
          "POST",
          "/items",
          books.id,
          itemInput(name),
        );
        assert.equal(response.statusCode, 201, response.body);
        return response.json<{ id: string }>().id;
      }
      function stockCsv(entries: { id: string; count: number }[]) {
        return [
          IMPORT_COLUMNS["opening-stock"].join(","),
          ...entries.flatMap(({ id, count }) =>
            Array.from({ length: count }, (_, i) =>
              IMPORT_COLUMNS["opening-stock"]
                .map(
                  (key) =>
                    ({
                      itemId: id,
                      lotNumber: `batch-${i}`,
                      date: books.fyStart,
                      bookScope: "nongst",
                      quantity: "1",
                      unitCost: "1.00",
                    })[key],
                )
                .join(","),
            ),
          ),
        ].join("\n");
      }
      async function importLots(entries: { id: string; count: number }[]) {
        const text = stockCsv(entries);
        const preview = await call("POST", "/imports/preview", books.id, {
          kind: "opening-stock",
          text,
        });
        assert.equal(preview.statusCode, 200, preview.body);
        const body = preview.json<{
          canApply: boolean;
          previewToken: string;
        }>();
        assert.equal(body.canApply, true, preview.body);
        const applied = await call(
          "POST",
          "/imports/apply",
          books.id,
          {
            kind: "opening-stock",
            text,
            previewToken: body.previewToken,
            confirmed: true,
          },
          owner.cookie,
          { "idempotency-key": randomUUID() },
        );
        assert.equal(applied.statusCode, 200, applied.body);
        assert.equal(
          applied.json<{ status: string }>().status,
          "applied",
          applied.body,
        );
      }
      await t.test(
        "200/201/500 opening lots import and serialize; 500 distributed rows also work",
        async () => {
          for (const count of [200, 201, 500]) {
            const id = await createItem(`Goods ${count}`);
            await importLots([{ id, count }]);
            const listed = await call("GET", "/items?limit=200", books.id);
            assert.equal(listed.statusCode, 200, listed.body);
            const row = await db
              .select()
              .from(schema.items)
              .where(eq(schema.items.id, id));
            assert.equal(row[0]?.openingLots?.length, count);
          }
          const one = await createItem("Distributed one");
          const two = await createItem("Distributed two");
          const three = await createItem("Distributed three");
          await importLots([
            { id: one, count: 200 },
            { id: two, count: 200 },
            { id: three, count: 100 },
          ]);
        },
      );
      await t.test(
        "501-row preview is rejected without stock or receipt writes",
        async () => {
          const id = await createItem("Too many lots");
          const before = await pool.query(
            "select count(*) from master_import_batches",
          );
          const preview = await call("POST", "/imports/preview", books.id, {
            kind: "opening-stock",
            text: stockCsv([{ id, count: 501 }]),
          });
          assert.equal(preview.statusCode, 200, preview.body);
          assert.equal(preview.json<{ canApply: boolean }>().canApply, false);
          const [item] = await db
            .select()
            .from(schema.items)
            .where(eq(schema.items.id, id));
          assert.equal(item?.openingStock, 0);
          assert.equal(item?.openingLots, null);
          assert.deepEqual(
            (await pool.query("select count(*) from master_import_batches"))
              .rows,
            before.rows,
          );
        },
      );
      await t.test(
        "oversized old items export and restore without becoming unreadable",
        async () => {
          const exported = await call("GET", "/backup/export", books.id);
          assert.equal(exported.statusCode, 200, exported.body);
          const { text } = exported.json<{ text: string }>();
          const preview = await call(
            "POST",
            "/backup/restore-preview",
            books.id,
            { text, name: `${tag} restored` },
          );
          assert.equal(preview.statusCode, 200, preview.body);
          const restored = await call("POST", "/backup/restore", books.id, {
            text,
            previewId: preview.json<{ previewId: string }>().previewId,
            confirmNewFirm: true,
            acknowledgeMissingAttachments: true,
          });
          assert.equal(restored.statusCode, 200, restored.body);
          const list = await call(
            "GET",
            "/items?limit=200",
            restored.json<{ firmId: string }>().firmId,
          );
          assert.equal(list.statusCode, 200, list.body);
          // A forged but checksummed export cannot bypass the common item-lot bound.
          const file = JSON.parse(text);
          file.payload.data.items[0].openingLots = lots(501);
          file.payload.data.items[0].openingStock = 501;
          file.integrity.digest = exportDigest(file.payload);
          const rejected = await call(
            "POST",
            "/backup/restore-preview",
            books.id,
            { text: JSON.stringify(file), name: `${tag} invalid` },
          );
          assert.equal(rejected.statusCode, 400, rejected.body);
        },
      );

      const library = await firm("Document library");
      async function document() {
        const reserve = await call(
          "POST",
          "/documents/upload-url",
          library.id,
          {
            name: "fixture.jpg",
            kind: "bill",
            contentType: "image/jpeg",
            sizeBytes: 100,
          },
        );
        assert.equal(reserve.statusCode, 201, reserve.body);
        const {
          document: { id },
          key,
        } = reserve.json<{ document: { id: string }; key: string }>();
        const confirmed = await call(
          "POST",
          `/documents/${id}/confirm`,
          library.id,
        );
        assert.equal(confirmed.statusCode, 200, confirmed.body);
        return { id, key };
      }
      const deletion = (
        id: string,
        cookie = owner.cookie,
        firmId = library.id,
      ) => call("DELETE", `/documents/${id}`, firmId, undefined, cookie);
      async function makeDue(id: string) {
        await pool.query(
          "update document_cleanup set next_attempt_at = now() - interval '1 second', lease_until = null where document_id = $1",
          [id],
        );
      }
      const removedKeys: string[] = [];
      const objectStorage = {
        async removeObject(key: string) {
          removedKeys.push(key);
        },
      };

      await t.test(
        "cross-firm and unauthorized deletion cannot create cleanup work",
        async () => {
          const file = await document();
          assert.equal(
            (await deletion(file.id, outsider.cookie)).statusCode,
            403,
          );
          assert.equal(
            (await deletion(file.id, owner.cookie, books.id)).statusCode,
            404,
          );
          assert.equal(
            (
              await pool.query(
                "select count(*) from document_cleanup where document_id = $1",
                [file.id],
              )
            ).rows[0].count,
            "0",
          );
        },
      );
      await t.test(
        "outbox insertion failure rolls back tombstone and preserves bytes",
        async () => {
          const file = await document();
          await pool.query(`create function fail_cleanup_fixture() returns trigger language plpgsql as $$
        begin raise exception 'synthetic cleanup insert failure'; end $$`);
          await pool.query(
            "create trigger fail_cleanup_fixture before insert on document_cleanup for each row execute function fail_cleanup_fixture()",
          );
          try {
            assert.equal((await deletion(file.id)).statusCode, 500);
            const [row] = await db
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, file.id));
            assert.equal(row?.deletedAt, null);
            assert.equal(apiDeleteCalls, 0);
          } finally {
            await pool.query(
              "drop trigger fail_cleanup_fixture on document_cleanup",
            );
            await pool.query("drop function fail_cleanup_fixture()");
          }
        },
      );
      await t.test(
        "commit failure rolls back deletion before any remote operation",
        async () => {
          const file = await document();
          await pool.query(`create function fail_commit_fixture() returns trigger language plpgsql as $$
        begin raise exception 'synthetic deferred commit failure'; end $$`);
          await pool.query(
            "create constraint trigger fail_commit_fixture after insert on document_cleanup deferrable initially deferred for each row execute function fail_commit_fixture()",
          );
          try {
            assert.equal((await deletion(file.id)).statusCode, 500);
            assert.equal(
              (
                await pool.query(
                  "select deleted_at from documents where id = $1",
                  [file.id],
                )
              ).rows[0].deleted_at,
              null,
            );
            assert.equal(apiDeleteCalls, 0);
          } finally {
            await pool.query(
              "drop trigger fail_commit_fixture on document_cleanup",
            );
            await pool.query("drop function fail_commit_fixture()");
          }
        },
      );
      await t.test(
        "deletion is repeatable and blocks access, renewal and confirmation",
        async () => {
          const file = await document();
          assert.equal((await deletion(file.id)).statusCode, 200);
          assert.equal((await deletion(file.id)).statusCode, 200);
          assert.equal(
            (await call("POST", `/documents/${file.id}/confirm`, library.id))
              .statusCode,
            404,
          );
          assert.equal(
            (await call("GET", `/documents/${file.id}/upload-url`, library.id))
              .statusCode,
            404,
          );
          assert.equal(
            (
              await call(
                "GET",
                `/documents/${file.id}/download-url`,
                library.id,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await pool.query(
                "select count(*) from document_cleanup where document_id = $1",
                [file.id],
              )
            ).rows[0].count,
            "1",
          );
          await makeDue(file.id);
          assert.deepEqual(await runDocumentCleanup(db, objectStorage), {
            completed: 0,
            failed: 0,
          });
          assert.equal(removedKeys.length, 0);
        },
      );
      await t.test(
        "only deletions visible in the retained snapshot become safe",
        async () => {
          const before = await document();
          assert.equal((await deletion(before.id)).statusCode, 200);
          const client = await pool.connect();
          let ids: string[] = [];
          const after = await document();
          try {
            await client.query(
              "begin isolation level repeatable read read only",
            );
            await client.query("select pg_export_snapshot()");
            assert.equal((await deletion(after.id)).statusCode, 200);
            ids = await listSnapshotCleanupIds(client);
            assert.ok(ids.includes(before.id));
            assert.equal(ids.includes(after.id), false);
            await client.query("commit");
          } finally {
            await client.query("rollback");
            client.release();
          }
          await markDocumentCleanupBackupSafe(
            db,
            ids,
            "verified-synthetic-snapshot",
          );
          await makeDue(before.id);
          await makeDue(after.id);
          const result = await runDocumentCleanup(db, objectStorage);
          assert.ok(result.completed >= 1);
          assert.ok(removedKeys.includes(before.key));
          assert.equal(removedKeys.includes(after.key), false);
        },
      );
      await t.test(
        "each partial object-delete failure retries safely after worker restart",
        async () => {
          for (const failAt of [0, 1, 2]) {
            const file = await document();
            assert.equal((await deletion(file.id)).statusCode, 200);
            await markDocumentCleanupBackupSafe(
              db,
              [file.id],
              `verified-failure-${failAt}`,
            );
            await makeDue(file.id);
            const keys = [
              `${file.key}.thumb.jpg`,
              file.key,
              `pending/${file.key}`,
            ];
            const bytes = new Set(keys);
            let calls = 0;
            const failed = await runDocumentCleanup(db, {
              async removeObject(key) {
                if (calls++ === failAt)
                  throw new Error("synthetic provider failure");
                bytes.delete(key);
              },
            });
            assert.equal(failed.failed, 1);
            assert.equal(
              (
                await pool.query(
                  "select completed_at from document_cleanup where document_id = $1",
                  [file.id],
                )
              ).rows[0].completed_at,
              null,
            );
            await makeDue(file.id);
            const restarted = createDb(url.toString());
            try {
              const retried = await runDocumentCleanup(restarted.db, {
                async removeObject(key) {
                  bytes.delete(key);
                },
              });
              assert.equal(retried.completed, 1);
              assert.equal(bytes.size, 0);
            } finally {
              await restarted.pool.end();
            }
          }
        },
      );
      await t.test(
        "expired lease retries once and concurrent workers do not duplicate an active claim",
        async () => {
          const file = await document();
          assert.equal((await deletion(file.id)).statusCode, 200);
          await markDocumentCleanupBackupSafe(
            db,
            [file.id],
            "verified-restart",
          );
          await pool.query(
            "update document_cleanup set next_attempt_at = now(), lease_until = now() - interval '1 second', lease_token = $2 where document_id = $1",
            [file.id, randomUUID()],
          );
          const calls: string[] = [];
          const remover = {
            async removeObject(key: string) {
              calls.push(key);
              await new Promise((resolve) => setTimeout(resolve, 10));
            },
          };
          const results = await Promise.all([
            runDocumentCleanup(db, remover),
            runDocumentCleanup(db, remover),
          ]);
          assert.equal(
            results.reduce((n, r) => n + r.completed, 0),
            1,
          );
          assert.equal(calls.length, 3);
        },
      );
      await t.test(
        "malformed cross-firm object keys never reach storage",
        async () => {
          const file = await document();
          assert.equal((await deletion(file.id)).statusCode, 200);
          const foreignKey = `firms/${books.id}/documents/${file.id}.jpg`;
          await pool.query("update documents set s3_key = $2 where id = $1", [
            file.id,
            foreignKey,
          ]);
          await pool.query(
            "update document_cleanup set object_key = $2, thumbnail_key = null where document_id = $1",
            [file.id, foreignKey],
          );
          await markDocumentCleanupBackupSafe(
            db,
            [file.id],
            "verified-tampered",
          );
          await makeDue(file.id);
          const before = removedKeys.length;
          assert.deepEqual(await runDocumentCleanup(db, objectStorage), {
            completed: 0,
            failed: 1,
          });
          assert.equal(removedKeys.length, before);
        },
      );
      assert.equal(apiDeleteCalls, 0);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);

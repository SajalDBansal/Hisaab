import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@repo/backend/db/client";
import { scheduleDocumentCleanup } from "@repo/backend/modules/documents/cleanup";
import { handleJob } from "../jobs/handlers";
import { BackupError, backupEnabled, type BackupConfig } from "./config";
import { type captureDatabase, type CaptureInput } from "./capture";
import { createBackupService } from "./runner";
import type { BackupStorage } from "./storage";
import type { Archive, Manifest, StoredManifest } from "./types";

const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const log = { info() {}, warn() {} };
const configBase = {
  BACKUP_INSTALLATION_ID: "runner-fixture-installation",
  BACKUP_WRITER_ID: "runner-fixture-writer",
  BACKUP_R2_BUCKET: "private-runner-fixture",
  BACKUP_R2_ENDPOINT: "https://fixture.invalid",
  BACKUP_R2_ACCESS_KEY_ID: "fixture-key",
  BACKUP_R2_SECRET_ACCESS_KEY: "fixture-secret",
  SENTRY_RELEASE: "fixture",
};

function memoryStorage() {
  const objects = new Map<string, Buffer>();
  let current: StoredManifest | null = null;
  let puts = 0,
    uploads = 0,
    cleanups = 0;
  let publicationFault: "none" | "before" | "after" = "none";
  let corrupted = false;
  const storage: BackupStorage = {
    async read(signal) {
      signal.throwIfAborted();
      return current;
    },
    async publish(manifest, expected, signal) {
      signal.throwIfAborted();
      puts++;
      if (publicationFault === "before") throw new Error("PUT not committed");
      if (expected !== (current?.etag ?? null))
        throw new Error("conditional conflict");
      current = { manifest, etag: `etag-${puts}` };
      if (publicationFault === "after")
        throw new Error("committed PUT response lost");
    },
    async upload(path, archive, _md5, signal) {
      signal.throwIfAborted();
      uploads++;
      objects.set(
        archive.key,
        corrupted ? Buffer.from("corrupt") : await readFile(path),
      );
    },
    async verify(archive, signal) {
      signal.throwIfAborted();
      const bytes = objects.get(archive.key);
      if (
        !bytes ||
        bytes.length !== archive.bytes ||
        digest(bytes) !== archive.sha256
      )
        throw new BackupError("BACKUP_CHECKSUM_MISMATCH");
    },
    async cleanup(manifest, signal) {
      signal.throwIfAborted();
      cleanups++;
      for (const key of objects.keys())
        if (key !== manifest.archive?.key) objects.delete(key);
      return 0;
    },
    close() {},
  };
  return {
    storage,
    objects,
    puts: () => puts,
    uploads: () => uploads,
    cleanups: () => cleanups,
    current: () => current,
    set(manifest: Manifest) {
      current = { manifest, etag: `baseline-${randomUUID()}` };
    },
    fault(value: typeof publicationFault) {
      publicationFault = value;
    },
    corrupt() {
      corrupted = true;
    },
  };
}

function fakeCapture(before?: (input: CaptureInput) => Promise<void>) {
  let calls = 0,
    disposed = 0;
  const capture: typeof captureDatabase = async (input) => {
    calls++;
    await before?.(input);
    input.signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), "hisaab-runner-test-"));
    const path = join(directory, "fixture.dump");
    const bytes = Buffer.from(`PGDMP synthetic snapshot ${input.snapshot}`);
    await writeFile(path, bytes, { mode: 0o600 });
    return {
      path,
      bytes: bytes.length,
      sha256: digest(bytes),
      md5: createHash("md5").update(bytes).digest("base64"),
      clientVersion: "17.fixture",
      async dispose() {
        disposed++;
        await rm(directory, { recursive: true, force: true });
      },
    };
  };
  return { capture, calls: () => calls, disposed: () => disposed };
}

function latch() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test(
  "full backup runner uses PostgreSQL authority and retains safe recovery state on failures",
  {
    skip: !process.env.HISAAB_RUNNER_TEST_URL,
    timeout: 60_000,
  },
  async (t) => {
    const databaseUrl = process.env.HISAAB_RUNNER_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_backup");
    const config: BackupConfig = { ...configBase, DATABASE_URL: databaseUrl };
    const { db, pool } = createDb(databaseUrl);
    const firmId = randomUUID();
    await db
      .insert(schema.user)
      .values({
        id: randomUUID(),
        name: "Runner fixture",
        email: `runner-${firmId}@example.invalid`,
      });
    await db
      .insert(schema.organization)
      .values({
        id: firmId,
        name: "Runner fixture",
        slug: firmId,
        createdAt: new Date(),
      });

    async function setup(
      options: {
        initialized?: boolean;
        writer?: string;
        archive?: Archive;
      } = {},
    ) {
      await pool.query("delete from document_cleanup");
      await pool.query("delete from backup_state");
      const store = memoryStorage();
      store.set({
        version: 1,
        installationId: config.BACKUP_INSTALLATION_ID,
        writerId: options.writer ?? config.BACKUP_WRITER_ID,
        revision: randomUUID(),
        archive: options.archive ?? null,
      });
      if (options.initialized !== false)
        await pool.query(
          "insert into backup_state(id, installation_id, writer_id) values (1, $1, $2)",
          [config.BACKUP_INSTALLATION_ID, config.BACKUP_WRITER_ID],
        );
      return store;
    }
    async function document(deleted: boolean) {
      const id = randomUUID();
      const key = `firms/${firmId}/documents/${id}.jpg`;
      await db
        .insert(schema.documents)
        .values({
          id,
          firmId,
          name: "fixture.jpg",
          kind: "bill",
          sizeBytes: 10,
          s3Key: key,
          contentType: "image/jpeg",
          uploadedOn: "2026-10-26",
          readyAt: new Date(),
        });
      const remove = async () =>
        db.transaction(async (tx) => {
          const deletedAt = new Date();
          await tx
            .update(schema.documents)
            .set({ deletedAt })
            .where(eq(schema.documents.id, id));
          await scheduleDocumentCleanup(tx as unknown as typeof db, {
            documentId: id,
            firmId,
            objectKey: key,
            thumbnailKey: null,
            deletedAt,
          });
        });
      if (deleted) await remove();
      return { id, key, remove };
    }
    async function state() {
      return (await pool.query("select * from backup_state where id = 1"))
        .rows[0];
    }

    try {
      await t.test(
        "only the dump snapshot's committed deletions become cleanup-safe",
        async () => {
          const store = await setup();
          const early = await document(true);
          const late = await document(false);
          const capture = fakeCapture(async ({ snapshot }) => {
            await late.remove();
            const reader = await pool.connect();
            try {
              await reader.query(
                "begin isolation level repeatable read read only",
              );
              assert.match(snapshot, /^[0-9a-f]+-[0-9a-f]+-\d+$/i);
              await reader.query(`set transaction snapshot '${snapshot}'`);
              const rows = await reader.query(
                "select id, deleted_at from documents where id = any($1::uuid[])",
                [[early.id, late.id]],
              );
              assert.ok(
                rows.rows.find((row) => row.id === early.id)?.deleted_at,
              );
              assert.equal(
                rows.rows.find((row) => row.id === late.id)?.deleted_at,
                null,
              );
              await reader.query("commit");
            } finally {
              await reader.query("rollback");
              reader.release();
            }
          });
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await service.run();
            const rows = await pool.query(
              "select document_id, backup_safe_at from document_cleanup",
            );
            assert.ok(
              rows.rows.find((row) => row.document_id === early.id)
                ?.backup_safe_at,
            );
            assert.equal(
              rows.rows.find((row) => row.document_id === late.id)
                ?.backup_safe_at,
              null,
            );
            assert.equal((await state()).status, "completed");
            assert.equal(capture.disposed(), 1);
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "two service instances serialize through the PostgreSQL advisory lock",
        async () => {
          const store = await setup();
          const started = latch();
          const release = latch();
          const capture = fakeCapture(async () => {
            started.release();
            await release.promise;
          });
          const first = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          const second = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          const run = first.run();
          try {
            await started.promise;
            assert.deepEqual(await first.run(), { skipped: "already-running" });
            assert.deepEqual(await second.run(), { skipped: "another-worker" });
            release.release();
            await run;
            assert.equal(capture.calls(), 1);
          } finally {
            release.release();
            await Promise.all([first.close(), second.close()]);
          }
        },
      );

      await t.test(
        "lost committed PUT response still completes exactly one verified publication",
        async () => {
          const store = await setup();
          store.fault("after");
          const capture = fakeCapture();
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await service.run();
            assert.equal(store.puts(), 1);
            assert.equal(store.uploads(), 1);
            assert.equal((await state()).status, "completed");
            assert.equal((await state()).pending_publication, null);
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "rejected publication retains pending candidate and releases no documents until restart succeeds",
        async () => {
          const store = await setup();
          const deleted = await document(true);
          store.fault("before");
          const capture = fakeCapture();
          const previous = store.current()?.manifest.revision;
          const first = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await assert.rejects(first.run(), {
              message: "BACKUP_PUBLICATION_UNCERTAIN",
            });
          } finally {
            await first.close();
          }
          assert.equal(store.current()?.manifest.revision, previous);
          assert.equal(store.cleanups(), 0);
          assert.ok((await state()).pending_publication);
          assert.equal(
            (
              await pool.query(
                "select backup_safe_at from document_cleanup where document_id = $1",
                [deleted.id],
              )
            ).rows[0].backup_safe_at,
            null,
          );
          store.fault("none");
          const restarted = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await restarted.run();
            assert.equal(capture.calls(), 1);
            assert.equal((await state()).status, "completed");
            assert.ok(
              (
                await pool.query(
                  "select backup_safe_at from document_cleanup where document_id = $1",
                  [deleted.id],
                )
              ).rows[0].backup_safe_at,
            );
          } finally {
            await restarted.close();
          }
        },
      );

      await t.test(
        "corrupt uploaded bytes leave the previous manifest untouched",
        async () => {
          const store = await setup();
          const previous = store.current()?.manifest.revision;
          store.corrupt();
          const capture = fakeCapture();
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await assert.rejects(service.run(), {
              message: "BACKUP_CHECKSUM_MISMATCH",
            });
            assert.equal(store.current()?.manifest.revision, previous);
            assert.equal(store.puts(), 0);
            assert.equal(store.cleanups(), 0);
            assert.equal((await state()).pending_publication, null);
            assert.equal(capture.disposed(), 1);
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "uninitialized, changed-writer and foreign-database states fail closed",
        async () => {
          for (const mode of ["uninitialized", "writer", "database"] as const) {
            const store = await setup({
              initialized: mode !== "uninitialized",
              writer: mode === "writer" ? "other-writer" : undefined,
            });
            if (mode === "database")
              await pool.query(
                "update backup_state set installation_id = 'foreign-installation' where id = 1",
              );
            const capture = fakeCapture();
            const service = createBackupService(config, log, {
              storage: store.storage,
              capture: capture.capture,
            });
            try {
              await assert.rejects(service.run(), {
                message: {
                  uninitialized: "BACKUP_NOT_INITIALIZED",
                  writer: "BACKUP_WRITER_CHANGED",
                  database: "BACKUP_DATABASE_IDENTITY_MISMATCH",
                }[mode],
              });
              assert.equal(capture.calls(), 0);
              assert.equal(store.puts(), 0);
            } finally {
              await service.close();
            }
          }
        },
      );

      await t.test(
        "large source-count drops require explicit operator approval",
        async () => {
          const store = await setup();
          const capture = fakeCapture();
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await service.run();
            const current = store.current();
            assert.ok(current?.manifest.archive);
            store.set({
              ...current.manifest,
              archive: {
                ...current.manifest.archive,
                counts: { ...current.manifest.archive.counts, users: 100 },
              },
            });
            await assert.rejects(service.run({ force: true }), {
              message: "BACKUP_COUNT_DROP_REQUIRES_REVIEW",
            });
            assert.equal(capture.calls(), 1);
            await service.run({ force: true, approveCountDrop: true });
            assert.equal(capture.calls(), 2);
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "database completion failure holds documents until the already-published candidate reconciles",
        async () => {
          const store = await setup();
          const deleted = await document(true);
          const capture = fakeCapture();
          await pool.query(`create function fail_runner_commit_fixture() returns trigger language plpgsql as $$
        begin if NEW.status = 'completed' then raise exception 'synthetic completion failure'; end if; return NEW; end $$`);
          await pool.query(
            "create constraint trigger fail_runner_commit_fixture after update on backup_state deferrable initially deferred for each row execute function fail_runner_commit_fixture()",
          );
          const first = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await assert.rejects(first.run(), { message: "BACKUP_FAILED" });
          } finally {
            await first.close();
            await pool.query(
              "drop trigger fail_runner_commit_fixture on backup_state",
            );
            await pool.query("drop function fail_runner_commit_fixture()");
          }
          assert.ok(store.current()?.manifest.archive);
          assert.ok((await state()).pending_publication);
          assert.equal(store.cleanups(), 0);
          assert.equal(
            (
              await pool.query(
                "select backup_safe_at from document_cleanup where document_id = $1",
                [deleted.id],
              )
            ).rows[0].backup_safe_at,
            null,
          );
          const restarted = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          try {
            await restarted.run();
            assert.equal(capture.calls(), 1);
            assert.equal((await state()).status, "completed");
          } finally {
            await restarted.close();
          }
        },
      );

      await t.test(
        "shutdown cancels capture before publication and releases the session lock",
        async () => {
          const store = await setup();
          const started = latch();
          const capture = fakeCapture(async ({ signal }) => {
            started.release();
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("cancelled")),
                { once: true },
              ),
            );
          });
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          const run = service.run();
          const rejection = assert.rejects(run, { message: "BACKUP_ABORTED" });
          await started.promise;
          service.abort();
          await rejection;
          await service.close();
          assert.equal(store.puts(), 0);
          assert.equal(store.uploads(), 0);
          const check = await pool.connect();
          try {
            assert.equal(
              (
                await check.query(
                  "select pg_try_advisory_lock(17491, 3001) as locked",
                )
              ).rows[0].locked,
              true,
            );
            await check.query("select pg_advisory_unlock(17491, 3001)");
          } finally {
            check.release();
          }
        },
      );

      await t.test(
        "losing the dedicated database lock connection aborts publication",
        async () => {
          const store = await setup();
          const started = latch();
          const capture = fakeCapture(async ({ signal }) => {
            started.release();
            await new Promise<void>((_resolve, reject) =>
              signal.addEventListener(
                "abort",
                () => reject(new Error("lock connection lost")),
                { once: true },
              ),
            );
          });
          const service = createBackupService(config, log, {
            storage: store.storage,
            capture: capture.capture,
          });
          const rejection = assert.rejects(service.run(), {
            message: "BACKUP_ABORTED",
          });
          try {
            await started.promise;
            const killed =
              await pool.query(`select pg_terminate_backend(pid) as stopped from pg_stat_activity
          where datname = current_database() and application_name = 'hisaab-backup' and pid <> pg_backend_pid()`);
            assert.equal(killed.rowCount, 1);
            await rejection;
            assert.equal(store.puts(), 0);
            assert.equal(store.uploads(), 0);
          } finally {
            service.abort();
            await service.close();
          }
        },
      );

      await t.test(
        "a temporary heartbeat failure retries without uploading another archive",
        async () => {
          const store = await setup();
          const capture = fakeCapture();
          let attempts = 0;
          const service = createBackupService(
            { ...config, BACKUP_HEARTBEAT_URL: "https://monitor.example.invalid/ping" },
            log,
            {
              storage: store.storage,
              capture: capture.capture,
              notify: (async () => new Response("", { status: ++attempts === 1 ? 503 : 200 })) as typeof fetch,
            },
          );
          try {
            await service.run();
            assert.equal(attempts, 2);
            assert.equal(capture.calls(), 1);
            assert.equal(store.uploads(), 1);
            assert.equal((await state()).status, "completed");
            assert.equal((await state()).last_error_code, null);
            await service.run();
            assert.equal(attempts, 2, "inspecting a current backup must not send another success ping");
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "cleanup and heartbeat failures remain visible without invalidating a verified archive",
        async () => {
          const store = await setup();
          store.storage.cleanup = async () => { throw new Error("synthetic cleanup outage"); };
          const capture = fakeCapture();
          let attempts = 0;
          const service = createBackupService(
            { ...config, BACKUP_HEARTBEAT_URL: "https://monitor.example.invalid/ping" },
            log,
            {
              storage: store.storage,
              capture: capture.capture,
              notify: (async () => { attempts++; throw new Error("synthetic monitor outage"); }) as typeof fetch,
            },
          );
          try {
            await service.run();
            assert.equal(attempts, 2);
            assert.ok(store.current()?.manifest.archive);
            assert.equal((await state()).status, "completed");
            assert.equal((await state()).last_error_code, "BACKUP_CLEANUP_PENDING,BACKUP_HEARTBEAT_FAILED");
          } finally {
            await service.close();
          }
        },
      );

      await t.test(
        "disabled backup configuration does not expose a runnable backup handler",
        async () => {
          assert.equal(backupEnabled({}), false);
          await assert.rejects(
            handleJob("backup", { kind: "backup-database" }, { db, log }),
            { name: "UnrecoverableError" },
          );
        },
      );
    } finally {
      await pool.end();
    }
  },
);

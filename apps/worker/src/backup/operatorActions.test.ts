import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDb, schema } from "@repo/backend/db/client";
import { createMemoryJobs } from "@repo/backend/jobs/queues";
import { scheduleRecurringJobs } from "@repo/backend/jobs/schedule";
import {
  BACKUP_TIMEOUT_MS,
  backupEnabled,
  readBackupConfig,
  type BackupConfig,
} from "./config";
import {
  operatorTimeoutMs,
  parseOperatorCommand,
  runOperatorAction,
  type OperatorCommand,
} from "./operatorActions";
import { backupClient, sourceFacts } from "./state";
import type { BackupStorage } from "./storage";
import {
  backupDue,
  type Archive,
  type Manifest,
  type StoredManifest,
} from "./types";

const baseConfig = {
  BACKUP_INSTALLATION_ID: "operator-installation",
  BACKUP_WRITER_ID: "operator-new-writer",
  BACKUP_R2_BUCKET: "private-operator-backups",
  BACKUP_R2_ENDPOINT: "https://fixture.invalid",
  BACKUP_R2_ACCESS_KEY_ID: "operator-secret-key-marker",
  BACKUP_R2_SECRET_ACCESS_KEY: "operator-secret-value-marker",
  SENTRY_RELEASE: "fixture",
};
const previousWriter = "operator-previous-writer";
const signal = () => new AbortController().signal;

function storageFixture() {
  let current: StoredManifest | null = null;
  let puts = 0,
    reads = 0,
    verifies = 0;
  let loseResponse = false,
    loseRead = false,
    rejectPut = false,
    rejectVerify = false;
  let verifying: ((signal: AbortSignal) => Promise<void>) | undefined;
  const storage: BackupStorage = {
    async read() {
      reads++;
      if (puts && loseRead) {
        loseRead = false;
        throw new Error("synthetic read outage");
      }
      return current;
    },
    async publish(manifest, expected, abort) {
      abort.throwIfAborted();
      puts++;
      if (rejectPut || expected !== (current?.etag ?? null))
        throw new Error("synthetic write rejection");
      current = { manifest, etag: `etag-${puts}` };
      if (loseResponse) throw new Error("synthetic lost PUT response");
    },
    async verify(_archive, abort) {
      verifies++;
      abort.throwIfAborted();
      if (rejectVerify) throw new Error("synthetic checksum mismatch");
      await verifying?.(abort);
    },
    async upload() {
      throw new Error("Operator ownership actions must not upload archives");
    },
    async cleanup() {
      throw new Error("Operator ownership actions must not delete archives");
    },
    close() {},
  };
  return {
    storage,
    current: () => current,
    puts: () => puts,
    reads: () => reads,
    verifies: () => verifies,
    set(manifest: Manifest | null) {
      current = manifest ? { manifest, etag: randomUUID() } : null;
    },
    loseResponse() {
      loseResponse = true;
    },
    loseRead() {
      loseRead = true;
    },
    rejectPut() {
      rejectPut = true;
    },
    rejectVerify() {
      rejectVerify = true;
    },
    onVerify(callback: (signal: AbortSignal) => Promise<void>) {
      verifying = callback;
    },
  };
}

test("operator commands stay explicit and adoption has enough time to verify a large archive", () => {
  assert.deepEqual(parseOperatorCommand(["initialize"]), {
    kind: "initialize",
  });
  assert.deepEqual(parseOperatorCommand(["run"]), {
    kind: "run",
    approveCountDrop: false,
  });
  assert.deepEqual(parseOperatorCommand(["run", "--approve-count-drop"]), {
    kind: "run",
    approveCountDrop: true,
  });
  for (const args of [
    [],
    ["initialize", "extra"],
    ["status", "extra"],
    ["run", "anything"],
    ["adopt", "old"],
  ])
    assert.throws(() => parseOperatorCommand(args));
  assert.equal(operatorTimeoutMs({ kind: "initialize" }), 60_000);
  assert.equal(operatorTimeoutMs({ kind: "status" }), 60_000);
  assert.equal(
    operatorTimeoutMs({
      kind: "adopt",
      previousWriterId: "old",
      backupId: "id",
    }),
    BACKUP_TIMEOUT_MS,
  );
});

test("backup configuration defaults disabled and rejects unsafe storage without disclosing values", () => {
  assert.equal(backupEnabled({}), false);
  assert.equal(backupEnabled({ BACKUP_ENABLED: "false" }), false);
  assert.equal(backupEnabled({ BACKUP_ENABLED: "true" }), true);
  assert.throws(() => backupEnabled({ BACKUP_ENABLED: "yes" }));
  const good = {
    ...baseConfig,
    DATABASE_URL: "postgres://fixture.invalid/private",
  };
  assert.equal(readBackupConfig(good).BACKUP_WRITER_ID, good.BACKUP_WRITER_ID);
  for (const bad of [
    { ...good, BACKUP_R2_ENDPOINT: "http://fixture.invalid" },
    { ...good, R2_BUCKET: good.BACKUP_R2_BUCKET },
    { ...good, BACKUP_HEARTBEAT_URL: "http://fixture.invalid/monitor" },
    { ...good, BACKUP_R2_SECRET_ACCESS_KEY: undefined },
  ])
    assert.throws(
      () => readBackupConfig(bad),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(good.BACKUP_R2_ACCESS_KEY_ID),
    );
});

test("recurring jobs default off, and enabled backups get 02:00 IST plus bounded catch-up", async () => {
  const jobs = createMemoryJobs();
  await scheduleRecurringJobs(jobs);
  assert.equal(jobs.added.filter((job) => job.queue === "backup").length, 0);
  await scheduleRecurringJobs(jobs, true);
  const scheduled = jobs.added.filter((job) => job.queue === "backup");
  assert.equal(scheduled.length, 3);
  assert.deepEqual(
    scheduled.find((job) => job.id === "repeat-backup-2am-ist")?.options
      ?.repeat,
    { pattern: "0 2 * * *", tz: "Asia/Kolkata" },
  );
  assert.deepEqual(
    scheduled.find((job) => job.id === "repeat-backup-catch-up")?.options
      ?.repeat,
    { every: 30 * 60_000 },
  );
  assert.equal(
    scheduled.find((job) => job.id === "backup-startup-check")?.options
      ?.retryCompleted,
    true,
  );
  await scheduleRecurringJobs(jobs, false);
  assert.equal(
    jobs.added.some(
      (job) =>
        job.id === "repeat-backup-2am-ist" ||
        job.id === "repeat-backup-catch-up",
    ),
    false,
  );
  assert.equal(backupDue(null), true);
});

test(
  "operator initialization and adoption are verified, idempotent and private",
  {
    skip: !process.env.HISAAB_OPERATOR_TEST_URL,
    timeout: 60_000,
  },
  async (t) => {
    const databaseUrl = process.env.HISAAB_OPERATOR_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_data");
    const config: BackupConfig = { ...baseConfig, DATABASE_URL: databaseUrl };
    const { db, pool } = createDb(databaseUrl);
    const run = async (
      command: Exclude<OperatorCommand, { kind: "run" }>,
      store: ReturnType<typeof storageFixture>,
      enabled = false,
      abort = signal(),
    ) => {
      const client = backupClient(config);
      try {
        await client.connect();
        return await runOperatorAction(command, {
          client,
          storage: store.storage,
          config,
          enabled,
          signal: abort,
        });
      } finally {
        await client.end();
      }
    };
    const state = async () =>
      (await pool.query("select * from backup_state where id = 1")).rows[0];
    async function reset(writer?: string) {
      await pool.query("delete from backup_state");
      if (writer)
        await pool.query(
          "insert into backup_state(id, installation_id, writer_id) values (1, $1, $2)",
          [config.BACKUP_INSTALLATION_ID, writer],
        );
      return storageFixture();
    }
    async function retainedArchive(
      store: ReturnType<typeof storageFixture>,
      writer = previousWriter,
    ) {
      const client = await pool.connect();
      let facts: Awaited<ReturnType<typeof sourceFacts>>;
      try {
        facts = await sourceFacts(client);
      } finally {
        client.release();
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      const archive: Archive = {
        id,
        key: `installations/${config.BACKUP_INSTALLATION_ID}/archives/${id}.dump`,
        bytes: 10,
        sha256: "a".repeat(64),
        captureStartedAt: now,
        captureFinishedAt: now,
        verifiedAt: now,
        publishedAt: now,
        occurrence: "operator",
        serverVersion: facts.serverVersion,
        clientVersion: "17.fixture",
        release: "fixture",
        migrationCount: facts.migrationCount,
        migrationHash: facts.migrationHash,
        counts: facts.counts,
        coverage: "whole-database-v1; attachments-metadata-only",
        verification: "download-sha256-and-archive-list",
      };
      store.set({
        version: 1,
        installationId: config.BACKUP_INSTALLATION_ID,
        writerId: writer,
        revision: randomUUID(),
        archive,
      });
      return {
        kind: "adopt" as const,
        previousWriterId: previousWriter,
        backupId: id,
      };
    }
    try {
      await pool.query(
        "DELETE FROM document_cleanup; DELETE FROM documents; DELETE FROM change_log; DELETE FROM organization; DELETE FROM public.user; DELETE FROM backup_state;",
      );
      await t.test(
        "an empty database cannot initialize or publish over any archive",
        async () => {
          const store = await reset();
          await assert.rejects(run({ kind: "initialize" }, store), {
            message: "BACKUP_EMPTY_DATABASE",
          });
          assert.equal(store.puts(), 0);
          assert.equal(await state(), undefined);
        },
      );
      const firmId = randomUUID();
      await db.insert(schema.user).values({
        name: "Operator fixture",
        email: `operator-${firmId}@example.invalid`,
      });
      await db.insert(schema.organization).values({
        id: firmId,
        name: "Operator fixture",
        slug: firmId,
        createdAt: new Date(),
      });

      await t.test(
        "initialization verifies a lost response and retries without another publication",
        async () => {
          const store = await reset();
          store.loseResponse();
          await run({ kind: "initialize" }, store);
          const revision = store.current()?.manifest.revision;
          assert.equal((await state()).writer_id, config.BACKUP_WRITER_ID);
          await run({ kind: "initialize" }, store);
          assert.equal(store.puts(), 1);
          assert.equal(store.current()?.manifest.revision, revision);
        },
      );
      await t.test(
        "initialization recovers after committed publication and failed read-back",
        async () => {
          const store = await reset();
          store.loseResponse();
          store.loseRead();
          await assert.rejects(run({ kind: "initialize" }, store), {
            message: "synthetic read outage",
          });
          assert.equal(await state(), undefined);
          await run({ kind: "initialize" }, store);
          assert.equal(store.puts(), 1);
          assert.ok(await state());
        },
      );
      await t.test(
        "rejected initialization never records authority",
        async () => {
          const store = await reset();
          store.rejectPut();
          await assert.rejects(run({ kind: "initialize" }, store), {
            message: "BACKUP_PUBLICATION_UNCERTAIN",
          });
          assert.equal(await state(), undefined);
        },
      );
      await t.test(
        "initialization rejects foreign installations and writers",
        async () => {
          for (const mode of [
            "remote-installation",
            "remote-writer",
            "local-installation",
            "local-writer",
          ] as const) {
            const store = await reset(config.BACKUP_WRITER_ID);
            store.set({
              version: 1,
              installationId: config.BACKUP_INSTALLATION_ID,
              writerId: config.BACKUP_WRITER_ID,
              revision: randomUUID(),
              archive: null,
            });
            const current = store.current();
            assert.ok(current);
            if (mode === "remote-installation")
              store.set({
                ...current.manifest,
                installationId: "foreign-installation",
              });
            if (mode === "remote-writer")
              store.set({ ...current.manifest, writerId: "foreign-writer" });
            if (mode === "local-installation")
              await pool.query(
                "update backup_state set installation_id = 'foreign-installation'",
              );
            if (mode === "local-writer")
              await pool.query(
                "update backup_state set writer_id = 'foreign-writer'",
              );
            await assert.rejects(run({ kind: "initialize" }, store));
            assert.equal(store.puts(), 0);
          }
        },
      );
      await t.test(
        "missing manifests with saved history cannot be silently reinitialized",
        async () => {
          for (const column of ["last_published", "pending_publication"]) {
            const store = await reset(config.BACKUP_WRITER_ID);
            await pool.query(`update backup_state set ${column} = '{}'::jsonb`);
            await assert.rejects(run({ kind: "initialize" }, store), {
              message: "BACKUP_MANIFEST_MISSING",
            });
            assert.equal(store.puts(), 0);
          }
        },
      );
      await t.test(
        "fresh local state cannot initialize or adopt an existing archive",
        async () => {
          const store = await reset();
          const command = await retainedArchive(store, config.BACKUP_WRITER_ID);
          await assert.rejects(run({ kind: "initialize" }, store), {
            message: "USE_ADOPT_FOR_RESTORED_DATABASE",
          });
          await assert.rejects(run(command, store), {
            message: "BACKUP_ADOPTION_CONFIRMATION_REQUIRED",
          });
          assert.equal(store.puts(), 0);
        },
      );
      await t.test(
        "successful and repeated adoption preserve the exact retained archive",
        async () => {
          const store = await reset(previousWriter);
          const command = await retainedArchive(store);
          const before = store.current()?.manifest.archive;
          await run(command, store);
          const revision = store.current()?.manifest.revision;
          assert.equal((await state()).writer_id, config.BACKUP_WRITER_ID);
          assert.deepEqual(store.current()?.manifest.archive, before);
          await run(command, store);
          assert.equal(store.puts(), 1);
          assert.equal(store.current()?.manifest.revision, revision);
        },
      );
      await t.test(
        "adoption reconciles lost publication responses and failed read-back",
        async () => {
          for (const lostRead of [false, true]) {
            const store = await reset(previousWriter);
            const command = await retainedArchive(store);
            store.loseResponse();
            if (lostRead) {
              store.loseRead();
              await assert.rejects(run(command, store));
              assert.equal((await state()).writer_id, previousWriter);
            } else await run(command, store);
            const revision = store.current()?.manifest.revision;
            await run(command, store);
            assert.equal((await state()).writer_id, config.BACKUP_WRITER_ID);
            assert.equal(store.puts(), 1);
            assert.equal(store.current()?.manifest.revision, revision);
          }
        },
      );
      await t.test(
        "adoption recovers a failed local authority update without another R2 write",
        async () => {
          const store = await reset(previousWriter);
          const command = await retainedArchive(store);
          await pool.query(
            `create function fail_operator_update_fixture() returns trigger language plpgsql as $$ begin raise exception 'synthetic authority update failure'; end $$`,
          );
          await pool.query(
            "create trigger fail_operator_update_fixture before update on backup_state for each row execute function fail_operator_update_fixture()",
          );
          try {
            await assert.rejects(run(command, store));
          } finally {
            await pool.query(
              "drop trigger fail_operator_update_fixture on backup_state",
            );
            await pool.query("drop function fail_operator_update_fixture()");
          }
          assert.equal((await state()).writer_id, previousWriter);
          await run(command, store);
          assert.equal(store.puts(), 1);
          assert.equal((await state()).status, "adopted");
        },
      );
      await t.test(
        "wrong restore identity, counts or migrations block adoption before verification",
        async () => {
          for (const mode of ["backup-id", "counts", "migrations"] as const) {
            const store = await reset(previousWriter);
            const command = await retainedArchive(store);
            const current = store.current();
            assert.ok(current?.manifest.archive);
            if (mode === "backup-id") command.backupId = randomUUID();
            if (mode === "counts")
              store.set({
                ...current.manifest,
                archive: {
                  ...current.manifest.archive,
                  counts: { ...current.manifest.archive.counts, users: 999 },
                },
              });
            if (mode === "migrations")
              store.set({
                ...current.manifest,
                archive: {
                  ...current.manifest.archive,
                  migrationHash: "incorrect",
                },
              });
            await assert.rejects(run(command, store), {
              message: "BACKUP_RESTORED_DATABASE_MISMATCH",
            });
            assert.equal(store.puts(), 0);
            assert.equal(store.verifies(), 0);
          }
        },
      );
      await t.test(
        "foreign writer, reused writer and corrupt archive cannot be adopted",
        async () => {
          for (const mode of [
            "local-writer",
            "remote-writer",
            "same-writer",
            "corrupt",
          ] as const) {
            const store = await reset(previousWriter);
            const command = await retainedArchive(store);
            const current = store.current();
            assert.ok(current);
            if (mode === "local-writer")
              await pool.query(
                "update backup_state set writer_id = 'foreign-writer'",
              );
            if (mode === "remote-writer")
              store.set({ ...current.manifest, writerId: "foreign-writer" });
            if (mode === "same-writer")
              command.previousWriterId = config.BACKUP_WRITER_ID;
            if (mode === "corrupt") store.rejectVerify();
            await assert.rejects(run(command, store));
            assert.equal(store.puts(), 0);
          }
        },
      );
      await t.test(
        "enabled ownership changes are rejected and status includes no secrets",
        async () => {
          const store = await reset(previousWriter);
          const command = await retainedArchive(store);
          for (const action of [{ kind: "initialize" as const }, command])
            await assert.rejects(run(action, store, true), {
              message: "DISABLE_BACKUP_BEFORE_OWNERSHIP_CHANGE",
            });
          assert.equal(store.reads(), 0);
          assert.equal(store.puts(), 0);
          const result = JSON.stringify(
            await run({ kind: "status" }, store, true),
          );
          for (const secret of [
            databaseUrl,
            config.BACKUP_R2_ACCESS_KEY_ID,
            config.BACKUP_R2_SECRET_ACCESS_KEY,
            config.BACKUP_R2_ENDPOINT,
          ])
            assert.equal(result.includes(secret), false);
        },
      );
      await t.test(
        "losing the operator lock connection aborts archive verification before handover",
        async () => {
          const store = await reset(previousWriter);
          const command = await retainedArchive(store);
          let ready: () => void = () => undefined;
          const started = new Promise<void>((resolve) => {
            ready = resolve;
          });
          store.onVerify(async (abort) => {
            ready();
            await new Promise<void>((_resolve, reject) =>
              abort.addEventListener(
                "abort",
                () => reject(new Error("verification aborted")),
                { once: true },
              ),
            );
          });
          const rejected = assert.rejects(run(command, store));
          await started;
          const killed = await pool.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and application_name = 'hisaab-backup' and pid <> pg_backend_pid()",
          );
          assert.equal(killed.rowCount, 1);
          await rejected;
          assert.equal(store.puts(), 0);
          assert.equal((await state()).writer_id, previousWriter);
        },
      );
    } finally {
      await pool.end();
    }
  },
);

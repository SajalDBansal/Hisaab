import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDb, schema } from "@repo/backend/db/client";
import {
  runDocumentCleanup,
  scheduleDocumentCleanup,
} from "@repo/backend/modules/documents/cleanup";
import { assertWriter, reconcilePublication } from "./runner";
import { checkCountDrop, finishPublication, savePending } from "./state";
import {
  backupDue,
  dueOccurrence,
  type Archive,
  type PendingPublication,
  type StoredManifest,
} from "./types";
import type { BackupStorage } from "./storage";
import type { BackupConfig } from "./config";

const config: BackupConfig = {
  DATABASE_URL: "postgres://fixture.invalid/unused",
  BACKUP_INSTALLATION_ID: "fixture-installation",
  BACKUP_WRITER_ID: "fixture-writer",
  BACKUP_R2_BUCKET: "private-backup-fixture",
  BACKUP_R2_ENDPOINT: "https://fixture.invalid",
  BACKUP_R2_ACCESS_KEY_ID: "fixture-key",
  BACKUP_R2_SECRET_ACCESS_KEY: "fixture-secret",
  SENTRY_RELEASE: "fixture-release",
};
const signal = () => new AbortController().signal;

function candidate(): PendingPublication {
  const id = randomUUID();
  const at = "2026-10-26T20:30:00.000Z";
  const archive: Archive = {
    id,
    key: `installations/${config.BACKUP_INSTALLATION_ID}/archives/${id}.dump`,
    bytes: 10,
    sha256: "a".repeat(64),
    captureStartedAt: at,
    captureFinishedAt: at,
    verifiedAt: at,
    publishedAt: at,
    occurrence: "operator",
    serverVersion: "17.6",
    clientVersion: "17.6",
    release: "fixture",
    migrationCount: 29,
    migrationHash: "fixture",
    counts: { users: 1, firms: 1, vouchers: 2, postings: 4, documents: 1 },
    coverage: "whole-database-v1; attachments-metadata-only",
    verification: "download-sha256-and-archive-list",
  };
  return {
    expectedEtag: "old-etag",
    cleanupIds: [],
    manifest: {
      version: 1,
      installationId: config.BACKUP_INSTALLATION_ID,
      writerId: config.BACKUP_WRITER_ID,
      revision: randomUUID(),
      archive,
    },
  };
}

function publicationStore(pending: PendingPublication) {
  const previous = candidate().manifest;
  let current: StoredManifest | null = {
    manifest: previous,
    etag: pending.expectedEtag,
  };
  let puts = 0;
  let verifications = 0;
  let cleanups = 0;
  let losePutResponse = false;
  let rejectPut = false;
  let rejectVerification = false;
  let rejectReadAfterPut = false;
  let competingWriter = false;
  const storage: BackupStorage = {
    async read() {
      if (puts && rejectReadAfterPut) throw new Error("read outage");
      return current;
    },
    async publish(manifest, etag) {
      puts++;
      if (rejectPut || etag !== current?.etag)
        throw new Error("publication rejected");
      current = { manifest, etag: `committed-${puts}` };
      if (losePutResponse) throw new Error("response lost after commit");
    },
    async verify() {
      verifications++;
      if (rejectVerification) throw new Error("checksum rejected");
      if (competingWriter)
        current = { manifest: candidate().manifest, etag: "other-writer-won" };
    },
    async upload() {
      throw new Error("This stage must not upload another archive");
    },
    async cleanup() {
      cleanups++;
      return 0;
    },
    close() {},
  };
  return {
    storage,
    previous,
    current: () => current,
    puts: () => puts,
    verifications: () => verifications,
    cleanups: () => cleanups,
    lostResponse() {
      losePutResponse = true;
    },
    rejectPut() {
      rejectPut = true;
    },
    allowPut() {
      rejectPut = false;
    },
    corrupt() {
      rejectVerification = true;
    },
    loseRead() {
      rejectReadAfterPut = true;
    },
    competingWriter() {
      competingWriter = true;
    },
    alreadyPublished() {
      current = {
        manifest: pending.manifest,
        etag: "committed-before-restart",
      };
    },
  };
}

test("publication recovers a committed PUT whose response was lost", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.lostResponse();
  const published = await reconcilePublication(r2.storage, pending, signal());
  assert.equal(published.manifest.revision, pending.manifest.revision);
  assert.equal(r2.puts(), 1);
  assert.equal(r2.verifications(), 1);
  assert.equal(r2.cleanups(), 0);
});

test("publication restart recognizes the exact committed revision without another PUT", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.alreadyPublished();
  const published = await reconcilePublication(r2.storage, pending, signal());
  assert.equal(published.manifest.revision, pending.manifest.revision);
  assert.equal(r2.puts(), 0);
  assert.equal(r2.cleanups(), 0);
});

test("a failed PUT preserves previous state and the same candidate can retry", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.rejectPut();
  await assert.rejects(reconcilePublication(r2.storage, pending, signal()), {
    message: "BACKUP_PUBLICATION_UNCERTAIN",
  });
  assert.equal(r2.current()?.manifest.revision, r2.previous.revision);
  assert.equal(r2.cleanups(), 0);
  r2.allowPut();
  assert.equal(
    (await reconcilePublication(r2.storage, pending, signal())).manifest
      .revision,
    pending.manifest.revision,
  );
});

test("checksum failure prevents publication and archive cleanup", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.corrupt();
  await assert.rejects(reconcilePublication(r2.storage, pending, signal()), {
    message: "checksum rejected",
  });
  assert.equal(r2.current()?.manifest.revision, r2.previous.revision);
  assert.equal(r2.puts(), 0);
  assert.equal(r2.cleanups(), 0);
});

test("read failure after PUT leaves publication unresolved without deleting archives", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.loseRead();
  await assert.rejects(reconcilePublication(r2.storage, pending, signal()), {
    message: "read outage",
  });
  assert.equal(r2.current()?.manifest.revision, pending.manifest.revision);
  assert.equal(r2.cleanups(), 0);
});

test("a competing writer winning during verification cannot be overwritten", async () => {
  const pending = candidate();
  const r2 = publicationStore(pending);
  r2.competingWriter();
  await assert.rejects(reconcilePublication(r2.storage, pending, signal()), {
    message: "BACKUP_PUBLICATION_UNCERTAIN",
  });
  assert.equal(r2.current()?.etag, "other-writer-won");
  assert.equal(r2.cleanups(), 0);
});

test("missing or changed writer authority blocks publication", () => {
  assert.throws(() => assertWriter(null, config), {
    message: "BACKUP_MANIFEST_MISSING",
  });
  const wrong = candidate();
  wrong.manifest.writerId = "different-writer";
  assert.throws(
    () => assertWriter({ manifest: wrong.manifest, etag: "fixture" }, config),
    { message: "BACKUP_WRITER_CHANGED" },
  );
});

test("02:00 India schedule and count-loss safeguards remain explicit", () => {
  assert.equal(
    dueOccurrence(new Date("2026-10-26T20:29:59Z")),
    "2026-10-25T20:30:00.000Z",
  );
  assert.equal(
    dueOccurrence(new Date("2026-10-26T20:30:00Z")),
    "2026-10-26T20:30:00.000Z",
  );
  const value = candidate().manifest.archive;
  assert.ok(value);
  assert.equal(backupDue(value, new Date("2026-10-26T20:31:00Z")), false);
  assert.equal(backupDue(value, new Date("2026-10-27T20:31:00Z")), true);
  const previous = { ...value.counts, vouchers: 100 };
  assert.throws(() => checkCountDrop(previous, value.counts), {
    message: "BACKUP_COUNT_DROP_REQUIRES_REVIEW",
  });
  assert.doesNotThrow(() => checkCountDrop(previous, value.counts, true));
});

test(
  "backup publication completion and document-release markers commit atomically",
  {
    skip: !process.env.HISAAB_BACKUP_TEST_URL,
  },
  async () => {
    const databaseUrl = process.env.HISAAB_BACKUP_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_data");
    const { db, pool } = createDb(databaseUrl);
    const client = await pool.connect();
    const firmId = randomUUID();
    const documentId = randomUUID();
    const objectKey = `firms/${firmId}/documents/${documentId}.jpg`;
    const pending = candidate();
    pending.cleanupIds = [documentId];
    const previous = candidate().manifest;
    try {
      await client.query("delete from backup_state");
      await db.insert(schema.organization).values({
        id: firmId,
        name: "Backup atomicity fixture",
        slug: firmId,
        createdAt: new Date(),
      });
      await db.insert(schema.documents).values({
        id: documentId,
        firmId,
        name: "fixture.jpg",
        kind: "bill",
        sizeBytes: 10,
        s3Key: objectKey,
        thumbnailKey: `${objectKey}.thumb.jpg`,
        contentType: "image/jpeg",
        uploadedOn: "2026-10-26",
        deletedAt: new Date(),
        readyAt: new Date(),
      });
      await scheduleDocumentCleanup(db, {
        documentId,
        firmId,
        objectKey,
        thumbnailKey: `${objectKey}.thumb.jpg`,
        deletedAt: new Date(),
      });
      await client.query(
        "insert into backup_state (id, installation_id, writer_id, last_published) values (1, $1, $2, $3::jsonb)",
        [
          config.BACKUP_INSTALLATION_ID,
          config.BACKUP_WRITER_ID,
          JSON.stringify(previous),
        ],
      );
      await savePending(client, pending);
      await client.query(`create function fail_backup_commit_fixture() returns trigger language plpgsql as $$
      begin raise exception 'synthetic backup completion commit failure'; end $$`);
      await client.query(`create constraint trigger fail_backup_commit_fixture after update on document_cleanup
      deferrable initially deferred for each row execute function fail_backup_commit_fixture()`);
      try {
        await assert.rejects(finishPublication(client, pending));
      } finally {
        await client.query(
          "drop trigger fail_backup_commit_fixture on document_cleanup",
        );
        await client.query("drop function fail_backup_commit_fixture()");
      }
      const held = (
        await client.query(
          "select backup_safe_at from document_cleanup where document_id = $1",
          [documentId],
        )
      ).rows[0];
      assert.equal(held.backup_safe_at, null);
      const state = (
        await client.query(
          "select last_published, pending_publication from backup_state where id = 1",
        )
      ).rows[0];
      assert.equal(state.last_published.revision, previous.revision);
      assert.equal(
        state.pending_publication.manifest.revision,
        pending.manifest.revision,
      );
      await client.query(
        "update document_cleanup set next_attempt_at = now() where document_id = $1",
        [documentId],
      );
      const removed: string[] = [];
      const storage = {
        async removeObject(key: string) {
          removed.push(key);
        },
      };
      assert.deepEqual(await runDocumentCleanup(db, storage), {
        completed: 0,
        failed: 0,
      });
      await finishPublication(client, pending);
      assert.deepEqual(await runDocumentCleanup(db, storage), {
        completed: 1,
        failed: 0,
      });
      assert.deepEqual(
        new Set(removed),
        new Set([`${objectKey}.thumb.jpg`, objectKey, `pending/${objectKey}`]),
      );
    } finally {
      client.release();
      await pool.end();
    }
  },
);

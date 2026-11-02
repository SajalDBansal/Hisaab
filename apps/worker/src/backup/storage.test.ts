import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test, type TestContext } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { BackupConfig } from "./config";
import { createBackupStorage } from "./storage";
import type { Archive, Manifest } from "./types";

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
const prefix = `installations/${config.BACKUP_INSTALLATION_ID}/`;
const manifestKey = `${prefix}latest.json`;
const signal = () => new AbortController().signal;
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function archive(
  bytes: Buffer,
  captured = "2026-10-26T20:30:00.000Z",
): Archive {
  const id = randomUUID();
  return {
    id,
    key: `${prefix}archives/${id}.dump`,
    bytes: bytes.length,
    sha256: sha256(bytes),
    captureStartedAt: captured,
    captureFinishedAt: captured,
    verifiedAt: captured,
    publishedAt: captured,
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
}

function manifest(
  value: Archive | null,
  writerId = config.BACKUP_WRITER_ID,
): Manifest {
  return {
    version: 1,
    installationId: config.BACKUP_INSTALLATION_ID,
    writerId,
    revision: randomUUID(),
    archive: value,
  };
}

// A byte-level S3 adapter exercises the real storage code without any provider request.
function fakeR2(t: TestContext) {
  const objects = new Map<
    string,
    { bytes: Buffer; etag: string; lastModified: Date }
  >();
  const deleted: string[] = [];
  const missingTimes = new Set<string>();
  let revision = 0;
  const put = (key: string, bytes: Buffer, lastModified = new Date()) => {
    objects.set(key, { bytes, etag: `"revision-${++revision}"`, lastModified });
  };
  let failAfterManifestPut = false;
  let failBeforeManifestPut = false;
  let failure: string | undefined;
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      if (failure) throw Object.assign(new Error(failure), { name: failure });
      const value = objects.get(String(command.input.Key));
      if (!value)
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        Body: Readable.from([value.bytes]),
        ETag: value.etag,
        ContentLength: value.bytes.length,
        LastModified: missingTimes.has(String(command.input.Key))
          ? undefined
          : value.lastModified,
      };
    }
    if (command instanceof PutObjectCommand) {
      const key = String(command.input.Key);
      if (key === manifestKey && failBeforeManifestPut)
        throw new Error("connection lost before request");
      const current = objects.get(key);
      if (
        (command.input.IfNoneMatch === "*" && current) ||
        (command.input.IfMatch && current?.etag !== command.input.IfMatch)
      )
        throw Object.assign(new Error("conditional conflict"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      const source = command.input.Body;
      let bytes: Buffer;
      if (typeof source === "string") bytes = Buffer.from(source);
      else if (Buffer.isBuffer(source)) bytes = source;
      else {
        const chunks: Buffer[] = [];
        for await (const chunk of source as AsyncIterable<Uint8Array>)
          chunks.push(Buffer.from(chunk));
        bytes = Buffer.concat(chunks);
      }
      if (command.input.ContentMD5)
        assert.equal(
          createHash("md5").update(bytes).digest("base64"),
          command.input.ContentMD5,
        );
      put(key, bytes);
      if (key === manifestKey && failAfterManifestPut) {
        failAfterManifestPut = false;
        throw new Error("response lost after committed PUT");
      }
      return { ETag: objects.get(key)?.etag };
    }
    if (command instanceof ListObjectsV2Command) {
      return {
        Contents: [...objects]
          .filter(([key]) => key.startsWith(String(command.input.Prefix)))
          .map(([Key, value]) => ({
            Key,
            LastModified: missingTimes.has(Key)
              ? undefined
              : value.lastModified,
            Size: value.bytes.length,
          })),
        IsTruncated: false,
      };
    }
    if (command instanceof DeleteObjectCommand) {
      const key = String(command.input.Key);
      deleted.push(key);
      objects.delete(key);
      return {};
    }
    throw new Error("Unexpected S3 operation");
  });
  return {
    objects,
    deleted,
    put,
    loseManifestResponse() {
      failAfterManifestPut = true;
    },
    rejectManifestPut() {
      failBeforeManifestPut = true;
    },
    failRead(name: string) {
      failure = name;
    },
    hideModificationTime(key: string) {
      missingTimes.add(key);
    },
  };
}

test("manifest reads distinguish absent, inaccessible, corrupt and foreign state", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    assert.equal(await storage.read(signal()), null);
    r2.put(manifestKey, Buffer.from("not json"));
    await assert.rejects(storage.read(signal()));
    r2.put(
      manifestKey,
      Buffer.from(
        JSON.stringify({
          ...manifest(null),
          installationId: "another-installation",
        }),
      ),
    );
    await assert.rejects(storage.read(signal()), {
      message: "BACKUP_MANIFEST_INVALID",
    });
    const invalid = archive(Buffer.from("data"));
    invalid.key = "another-installation/archive.dump";
    r2.put(manifestKey, Buffer.from(JSON.stringify(manifest(invalid))));
    await assert.rejects(storage.read(signal()), {
      message: "BACKUP_MANIFEST_INVALID",
    });
    r2.failRead("AccessDenied");
    await assert.rejects(storage.read(signal()), { name: "AccessDenied" });
  } finally {
    storage.close();
  }
});

test("manifest initialization and replacement use conditional writes", async (t) => {
  fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    const initial = manifest(null);
    await storage.publish(initial, null, signal());
    await assert.rejects(storage.publish(manifest(null), null, signal()), {
      name: "PreconditionFailed",
    });
    const old = await storage.read(signal());
    assert.ok(old);
    const next = manifest(archive(Buffer.from("dump")));
    await storage.publish(next, old.etag, signal());
    await assert.rejects(storage.publish(manifest(null), old.etag, signal()), {
      name: "PreconditionFailed",
    });
    assert.equal(
      (await storage.read(signal()))?.manifest.revision,
      next.revision,
    );
  } finally {
    storage.close();
  }
});

test("archive upload is immutable and verification rejects truncated or corrupt bytes", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  const directory = await mkdtemp(
    join(tmpdir(), "hisaab-backup-storage-test-"),
  );
  try {
    const bytes = Buffer.from("synthetic custom archive bytes");
    const value = archive(bytes);
    const path = join(directory, "candidate.dump");
    await writeFile(path, bytes, { mode: 0o600 });
    const md5 = createHash("md5").update(bytes).digest("base64");
    await storage.upload(path, value, md5, signal());
    await storage.verify(value, signal());
    await assert.rejects(storage.upload(path, value, md5, signal()), {
      name: "PreconditionFailed",
    });
    for (const broken of [
      bytes.subarray(0, 2),
      Buffer.alloc(bytes.length),
      Buffer.concat([bytes, Buffer.from("extra")]),
    ]) {
      r2.put(value.key, broken);
      await assert.rejects(storage.verify(value, signal()), {
        message: "BACKUP_CHECKSUM_MISMATCH",
      });
    }
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a lost manifest PUT response leaves both archive objects available", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    const previous = archive(Buffer.from("previous"));
    const next = archive(Buffer.from("next"));
    r2.put(previous.key, Buffer.from("previous"));
    r2.put(next.key, Buffer.from("next"));
    await storage.publish(manifest(previous), null, signal());
    const before = await storage.read(signal());
    assert.ok(before);
    const candidate = manifest(next);
    r2.loseManifestResponse();
    await assert.rejects(storage.publish(candidate, before.etag, signal()));
    assert.equal(
      (await storage.read(signal()))?.manifest.revision,
      candidate.revision,
    );
    assert.ok(r2.objects.has(previous.key));
    assert.ok(r2.objects.has(next.key));
    assert.deepEqual(r2.deleted, []);
  } finally {
    storage.close();
  }
});

test("two writers using one manifest ETag cannot both publish", async (t) => {
  fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    await storage.publish(manifest(null), null, signal());
    const current = await storage.read(signal());
    assert.ok(current);
    const one = manifest(archive(Buffer.from("one")), "writer-one");
    const two = manifest(archive(Buffer.from("two")), "writer-two");
    const results = await Promise.allSettled([
      storage.publish(one, current.etag, signal()),
      storage.publish(two, current.etag, signal()),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
  } finally {
    storage.close();
  }
});

test("cleanup retains candidates uploaded after the current manifest was published", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    const currentBytes = Buffer.from("retained");
    const currentArchive = archive(currentBytes);
    const current = manifest(currentArchive);
    r2.put(currentArchive.key, currentBytes, new Date("2026-10-26T20:30:00Z"));
    r2.put(
      manifestKey,
      Buffer.from(JSON.stringify(current)),
      new Date("2026-10-26T20:31:00Z"),
    );
    const nextBytes = Buffer.from("currently uploading on a second host");
    const next = archive(nextBytes, "2026-10-26T20:32:00.000Z");
    r2.put(next.key, nextBytes, new Date("2026-10-26T20:33:00Z"));
    await storage.verify(next, signal());
    await storage.cleanup(current, signal());
    assert.ok(r2.objects.has(currentArchive.key));
    assert.ok(
      r2.objects.has(next.key),
      "cleanup removed a verified candidate before its conditional publication",
    );
  } finally {
    storage.close();
  }
});

test("cleanup removes older archives but retains equal or unknown server timestamps", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    const currentArchive = archive(Buffer.from("current"));
    const current = manifest(currentArchive);
    const publishedAt = new Date("2026-10-26T20:31:00Z");
    r2.put(
      currentArchive.key,
      Buffer.from("current"),
      new Date("2026-10-26T20:30:00Z"),
    );
    r2.put(manifestKey, Buffer.from(JSON.stringify(current)), publishedAt);
    const old = archive(Buffer.from("old"));
    const equal = archive(Buffer.from("same second"));
    const unknown = archive(Buffer.from("unknown timestamp"));
    r2.put(old.key, Buffer.from("old"), new Date("2026-10-26T20:29:00Z"));
    r2.put(equal.key, Buffer.from("same second"), publishedAt);
    r2.put(
      unknown.key,
      Buffer.from("unknown timestamp"),
      new Date("2026-10-26T20:29:00Z"),
    );
    r2.hideModificationTime(unknown.key);
    await storage.cleanup(current, signal());
    assert.deepEqual(r2.deleted, [old.key]);
    assert.ok(r2.objects.has(equal.key));
    assert.ok(r2.objects.has(unknown.key));
  } finally {
    storage.close();
  }
});

test("a stale cleaner cannot remove the newer writer's retained archive", async (t) => {
  const r2 = fakeR2(t);
  const storage = createBackupStorage(config);
  try {
    const previous = manifest(archive(Buffer.from("previous")));
    const next = manifest(archive(Buffer.from("next")), "new-writer");
    assert.ok(previous.archive);
    assert.ok(next.archive);
    r2.put(previous.archive.key, Buffer.from("previous"));
    r2.put(next.archive.key, Buffer.from("next"));
    r2.put(manifestKey, Buffer.from(JSON.stringify(next)));
    await assert.rejects(storage.cleanup(previous, signal()), {
      message: "BACKUP_WRITER_CHANGED",
    });
    assert.equal(r2.deleted.length, 0);
    assert.ok(r2.objects.has(next.archive.key));
  } finally {
    storage.close();
  }
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDatabaseCapture } from "./capture";
import { BackupError } from "./config";

const roots = new Set<string>();
const clients: ChildProcess[] = [];
const input = () => ({
  databaseUrl:
    "postgres://fixture:synthetic-connection-secret@127.0.0.1/fixture",
  snapshot: "00000003-0000001B-1",
  signal: new AbortController().signal,
});
const archive = Buffer.from("PGDMP synthetic complete archive bytes");
const tables = [
  "drizzle.__drizzle_migrations",
  "public.user",
  "public.account",
  "public.organization",
  "public.member",
  "public.parties",
  "public.items",
  "public.vouchers",
  "public.voucher_lines",
  "public.postings",
  "public.documents",
  "public.settlement_entries",
  "public.operation_receipts",
  "public.idempotency_keys",
];
const listing = tables
  .flatMap((table, i) =>
    ["TABLE", "TABLE DATA"].map(
      (kind) => `${100 + i}; 0 1234 ${kind} ${table.replace(".", " ")} fixture`,
    ),
  )
  .join("\n");

interface Scenario {
  dump?: string;
  list?: string;
  version?: string;
  bytes?: bigint;
  maxBytes?: number;
  timeoutMs?: number;
  onDump?: (child: ChildProcess) => void;
  missingClient?: boolean;
  uid?: number;
  processAlive?: (pid: number) => boolean;
}

async function fixture(scenario: Scenario = {}) {
  const root = await mkdtemp(join(tmpdir(), "hisaab-capture-check-"));
  roots.add(root);
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] =
    [];
  const capture = createDatabaseCapture({
    tempRoot: () => root,
    availableBytes: async () => scenario.bytes ?? 4n * 1024n ** 3n,
    timeoutMs: scenario.timeoutMs ?? 5_000,
    maxBytes: scenario.maxBytes ?? 1024 * 1024,
    killGraceMs: 30,
    ...(scenario.uid === undefined ? {} : { uid: () => scenario.uid }),
    ...(scenario.processAlive ? { processAlive: scenario.processAlive } : {}),
    start(command, args, env) {
      calls.push({ command, args, env });
      const version = args[0] === "--version";
      const code = version
        ? `process.stdout.write(${JSON.stringify(`${command} (PostgreSQL) ${scenario.version ?? "17.7"}\n`)})`
        : command === "pg_dump"
          ? (scenario.dump ??
            `process.stdout.write(Buffer.from('${archive.toString("base64")}', 'base64'))`)
          : (scenario.list ??
            `process.stdout.write(${JSON.stringify(listing)})`);
      const child = spawn(
        scenario.missingClient ? "hisaab-missing-pg-client" : process.execPath,
        ["-e", code],
        { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      clients.push(child);
      if (!version && command === "pg_dump") scenario.onDump?.(child);
      return child;
    },
  });
  return { root, capture, calls };
}

afterEach(async () => {
  for (const client of clients) {
    assert.ok(
      client.exitCode !== null || client.signalCode !== null || !client.pid,
      "Every child must finish before capture settles",
    );
  }
  clients.length = 0;
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.clear();
});

test("capture hashes exact bytes, uses the exported snapshot, and keeps connection out of argv", async () => {
  const f = await fixture();
  const result = await f.capture(input());
  assert.deepEqual(await readFile(result.path), archive);
  assert.equal(result.bytes, archive.length);
  assert.equal(
    result.sha256,
    createHash("sha256").update(archive).digest("hex"),
  );
  assert.equal(result.md5, createHash("md5").update(archive).digest("base64"));
  assert.equal(result.clientVersion, "17.7");
  const dump = f.calls.find(
    (call) => call.command === "pg_dump" && call.args[0] !== "--version",
  );
  assert.ok(dump);
  assert.ok(dump.args.includes(`--snapshot=${input().snapshot}`));
  assert.ok(dump.args.includes("--format=custom"));
  assert.equal(dump.env.PGDATABASE, "fixture");
  assert.equal(dump.env.PGHOST, "127.0.0.1");
  assert.equal(dump.env.PGUSER, "fixture");
  assert.equal(dump.env.PGPASSWORD, "synthetic-connection-secret");
  assert.equal(dump.env.PGCONNECT_TIMEOUT, "10");
  assert.equal(
    JSON.stringify(f.calls.map((call) => call.args)).includes(
      "synthetic-connection-secret",
    ),
    false,
  );
  assert.equal(dump.env.BACKUP_R2_SECRET_ACCESS_KEY, undefined);
  if (process.platform !== "win32") {
    assert.equal((await stat(dirname(result.path))).mode & 0o777, 0o700);
    assert.equal((await stat(result.path)).mode & 0o777, 0o600);
  }
  await result.dispose();
  await result.dispose();
  assert.deepEqual(await readdir(f.root), []);
});

test("low disk space fails before spawning any client", async () => {
  const f = await fixture({ bytes: 2n * 1024n ** 3n - 1n });
  await assert.rejects(f.capture(input()), { code: "BACKUP_DISK_SPACE_LOW" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("incorrect PostgreSQL client major is rejected", async () => {
  const f = await fixture({ version: "16.9" });
  await assert.rejects(f.capture(input()), {
    code: "BACKUP_POSTGRES_CLIENT_VERSION_MISMATCH",
  });
  assert.deepEqual(await readdir(f.root), []);
});

test("missing client fails without disclosing its environment", async () => {
  const f = await fixture({ missingClient: true });
  await assert.rejects(f.capture(input()), { code: "BACKUP_CLIENT_FAILED" });
  assert.deepEqual(await readdir(f.root), []);
});

test("failed pg_dump never returns its partial bytes or raw stderr", async () => {
  const f = await fixture({
    dump: "process.stdout.write('partial'); process.stderr.write('synthetic-connection-secret'); process.exitCode=1",
  });
  await assert.rejects(f.capture(input()), (error: unknown) => {
    assert.ok(error instanceof BackupError);
    assert.equal(error.code, "BACKUP_CLIENT_FAILED");
    assert.equal(
      String(error.stack).includes("synthetic-connection-secret"),
      false,
    );
    return true;
  });
  assert.deepEqual(await readdir(f.root), []);
});

test("empty and oversized archives are removed", async () => {
  for (const scenario of [
    { dump: "process.exit(0)", code: "BACKUP_ARCHIVE_EMPTY" },
    {
      dump: "process.stdout.write(Buffer.alloc(65536))",
      maxBytes: 1024,
      code: "BACKUP_ARCHIVE_TOO_LARGE",
    },
  ]) {
    const f = await fixture(scenario);
    await assert.rejects(f.capture(input()), { code: scenario.code });
    assert.deepEqual(await readdir(f.root), []);
  }
});

test("an output-file failure kills the writer and removes its owned temporary directory", async () => {
  const f = await fixture({
    dump: "process.stdout.write('partial'); setInterval(() => {}, 1000)",
    onDump: () => {
      const directory = readdirSync(f.root).find((name) =>
        name.startsWith("hisaab-pg-backup-"),
      );
      assert.ok(directory);
      // A directory at the intended file path reproduces a real filesystem write failure.
      mkdirSync(join(f.root, directory, "database.dump"));
    },
  });
  await assert.rejects(f.capture(input()), { code: "BACKUP_CAPTURE_FAILED" });
  assert.deepEqual(await readdir(f.root), []);
});

test("a schema-only or missing retry-table listing cannot pass", async () => {
  for (const text of [
    listing.replace(/^.*TABLE DATA.*$/gm, ""),
    listing.replace(/^.*operation_receipts.*$/gm, ""),
    listing.replace(/^.*__drizzle_migrations.*$/gm, ""),
  ]) {
    const f = await fixture({
      list: `process.stdout.write(${JSON.stringify(text)})`,
    });
    await assert.rejects(f.capture(input()), {
      code: "BACKUP_ARCHIVE_INCOMPLETE",
    });
    assert.deepEqual(await readdir(f.root), []);
  }
});

test("archive verification process errors discard an otherwise complete dump", async () => {
  const f = await fixture({
    list: `process.stdout.write(${JSON.stringify(listing)}); process.exitCode=1`,
  });
  await assert.rejects(f.capture(input()), { code: "BACKUP_CLIENT_FAILED" });
  assert.deepEqual(await readdir(f.root), []);
});

test("archive list lines and version output have strict memory bounds", async () => {
  const f = await fixture({ list: "process.stdout.write('x'.repeat(20000))" });
  await assert.rejects(f.capture(input()), {
    code: "BACKUP_ARCHIVE_LIST_INVALID",
  });
  const g = await fixture({ version: "17.7" + "x".repeat(5000) });
  await assert.rejects(g.capture(input()), {
    code: "BACKUP_CLIENT_OUTPUT_INVALID",
  });
});

test("caller cancellation kills and reaps the dump and removes its partial file", async () => {
  const controller = new AbortController();
  const f = await fixture({
    dump: "process.stdout.write('partial'); setInterval(() => {}, 1000)",
    onDump: (child) => {
      child.stdout?.once("data", () => controller.abort());
    },
  });
  await assert.rejects(f.capture({ ...input(), signal: controller.signal }), {
    code: "BACKUP_CAPTURE_ABORTED",
  });
  assert.deepEqual(await readdir(f.root), []);
});

test("already-cancelled work never spawns or creates temporary files", async () => {
  const controller = new AbortController();
  controller.abort(new Error("synthetic-connection-secret"));
  const f = await fixture();
  await assert.rejects(f.capture({ ...input(), signal: controller.signal }), {
    code: "BACKUP_CAPTURE_ABORTED",
  });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("capture deadline stops a stalled child even if it ignores graceful termination", async () => {
  const f = await fixture({
    timeoutMs: 500,
    dump: "process.on('SIGTERM', () => {}); process.stdout.write('partial'); setInterval(() => {}, 1000)",
  });
  await assert.rejects(f.capture(input()), { code: "BACKUP_CAPTURE_TIMEOUT" });
  assert.deepEqual(await readdir(f.root), []);
});

test("large stderr drains safely and disposal leaves unrelated files alone", async () => {
  const f = await fixture({
    dump: `process.stderr.write(Buffer.alloc(2 * 1024 * 1024)); process.stdout.write(Buffer.from('${archive.toString("base64")}', 'base64'))`,
  });
  await writeFile(join(f.root, "unrelated.txt"), "keep");
  const result = await f.capture(input());
  await result.dispose();
  assert.deepEqual(await readdir(f.root), ["unrelated.txt"]);
});

test("abandoned cleanup removes only old owned captures whose process is gone", async () => {
  const uid = process.getuid?.() ?? 0;
  const f = await fixture({ uid, processAlive: (pid) => pid === process.pid });
  const old = Date.now() - 30 * 60_000;
  const make = async (marker: unknown, stale = true) => {
    const path = await mkdtemp(join(f.root, "hisaab-pg-backup-"));
    await writeFile(join(path, "database.dump"), "partial", { mode: 0o600 });
    if (marker)
      await writeFile(
        join(path, ".capture-owner.json"),
        JSON.stringify(marker),
        { mode: 0o600 },
      );
    if (stale) await utimes(path, old / 1000, old / 1000);
    return path;
  };
  const marker = { version: 1, uid, pid: 2147483647, createdAt: old };
  const abandoned = await make(marker);
  const unowned = await make(undefined);
  const live = await make({ ...marker, pid: process.pid });
  const recent = await make({ ...marker, createdAt: Date.now() }, false);
  const other = await make({ ...marker, uid: uid + 1 });
  const malformed = await make({ ...marker, pid: -1 });
  const capture = await f.capture(input());
  await capture.dispose();
  await assert.rejects(stat(abandoned), { code: "ENOENT" });
  for (const path of [unowned, live, recent, other, malformed])
    assert.ok((await stat(path)).isDirectory());
});

test(
  "abandoned cleanup ignores symbolic links",
  { skip: process.platform === "win32" },
  async () => {
    const uid = process.getuid?.() ?? 0;
    const f = await fixture({ uid, processAlive: () => false });
    const target = await mkdtemp(join(f.root, "unrelated-"));
    const old = Date.now() - 30 * 60_000;
    await writeFile(
      join(target, ".capture-owner.json"),
      JSON.stringify({ version: 1, uid, pid: 2147483647, createdAt: old }),
    );
    await utimes(target, old / 1000, old / 1000);
    await symlink(target, join(f.root, "hisaab-pg-backup-abcdef"), "dir");
    const linkedMarker = await mkdtemp(join(f.root, "hisaab-pg-backup-"));
    await symlink(
      join(target, ".capture-owner.json"),
      join(linkedMarker, ".capture-owner.json"),
    );
    await utimes(linkedMarker, old / 1000, old / 1000);
    const capture = await f.capture(input());
    await capture.dispose();
    assert.ok((await stat(target)).isDirectory());
    assert.ok((await stat(linkedMarker)).isDirectory());
  },
);

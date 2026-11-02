import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  opendir,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BACKUP_TIMEOUT_MS, BackupError, MAX_ARCHIVE_BYTES } from "./config";

type Child = Pick<ChildProcess, "once" | "kill"> & {
  stdout: Readable;
  stderr: Readable;
};
interface CaptureRuntime {
  start: (command: string, args: string[], env: NodeJS.ProcessEnv) => Child;
  tempRoot: () => string;
  availableBytes: (path: string) => Promise<bigint>;
  maxBytes: number;
  timeoutMs: number;
  killGraceMs: number;
  now: () => number;
  uid: () => number | undefined;
  processAlive: (pid: number) => boolean;
}

const defaults: CaptureRuntime = {
  start: (command, args, env) =>
    spawn(command, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  tempRoot: tmpdir,
  availableBytes: async (path) => {
    const space = await statfs(path, { bigint: true });
    return space.bavail * space.bsize;
  },
  maxBytes: MAX_ARCHIVE_BYTES,
  timeoutMs: BACKUP_TIMEOUT_MS,
  killGraceMs: 1_000,
  now: Date.now,
  uid: () => process.getuid?.(),
  processAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  },
};

const ownerMarker = ".capture-owner.json";
const capturePrefix = "hisaab-pg-backup-";

/** Read only our small, regular owner marker; never follow links into another directory. */
async function abandonedOwner(path: string, runtime: CaptureRuntime) {
  const uid = runtime.uid();
  if (uid === undefined) return false;
  try {
    const directory = await lstat(path);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.uid !== uid ||
      runtime.now() - directory.mtimeMs <= BACKUP_TIMEOUT_MS
    )
      return false;
    const markerPath = join(path, ownerMarker);
    const marker = await lstat(markerPath);
    if (
      !marker.isFile() ||
      marker.isSymbolicLink() ||
      marker.uid !== uid ||
      marker.size > 1024
    )
      return false;
    const file = await open(
      markerPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const actual = await file.stat();
      if (actual.uid !== uid || actual.size > 1024) return false;
      const buffer = Buffer.alloc(1025);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1024) return false;
      const owner = JSON.parse(
        buffer.subarray(0, bytesRead).toString("utf8"),
      ) as Record<string, unknown>;
      return (
        owner.version === 1 &&
        owner.uid === uid &&
        typeof owner.pid === "number" &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        owner.pid <= 2147483647 &&
        typeof owner.createdAt === "number" &&
        Number.isSafeInteger(owner.createdAt) &&
        owner.createdAt > 0 &&
        runtime.now() - owner.createdAt > BACKUP_TIMEOUT_MS &&
        !runtime.processAlive(owner.pid)
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

/** Old directories are removed only when both ownership and a dead process can be established. */
async function removeAbandonedCaptures(
  root: string,
  runtime: CaptureRuntime,
  signal: AbortSignal,
) {
  const entries = await opendir(root);
  for await (const entry of entries) {
    checkCancelled(signal);
    if (!/^hisaab-pg-backup-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
    const path = join(root, entry.name);
    if (await abandonedOwner(path, runtime))
      await rm(path, { recursive: true, force: true });
  }
}

export interface CaptureInput {
  databaseUrl: string;
  snapshot: string;
  signal: AbortSignal;
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted)
    throw signal.reason instanceof BackupError
      ? signal.reason
      : new BackupError("BACKUP_CAPTURE_ABORTED");
}

// Child clients receive the connection privately and cannot read an inherited password file.
function clientEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length <= 1
  )
    throw new BackupError("BACKUP_DATABASE_URL_INVALID");
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "LD_LIBRARY_PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
  ])
    if (process.env[key]) env[key] = process.env[key];
  const parameters: Record<string, string> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    sslpassword: "PGSSLPASSWORD",
    ssl_min_protocol_version: "PGSSLMINPROTOCOLVERSION",
    ssl_max_protocol_version: "PGSSLMAXPROTOCOLVERSION",
    channel_binding: "PGCHANNELBINDING",
    application_name: "PGAPPNAME",
    options: "PGOPTIONS",
    target_session_attrs: "PGTARGETSESSIONATTRS",
  };
  for (const [key, value] of url.searchParams) {
    if (!parameters[key])
      throw new BackupError("BACKUP_DATABASE_URL_OPTION_UNSUPPORTED");
    env[parameters[key]] = value;
  }
  return {
    ...env,
    // libpq expands explicit connection strings, but PGDATABASE defaults are plain database names.
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "10",
    // pg_dump may reset statement limits; the process deadline still bounds the full capture.
    PGOPTIONS:
      `${env.PGOPTIONS ?? ""} -c lock_timeout=10000 -c statement_timeout=${BACKUP_TIMEOUT_MS}`.trim(),
    PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  };
}

/** Drain diagnostics without retaining potentially sensitive PostgreSQL messages. */
async function runClient<T>(
  runtime: CaptureRuntime,
  signal: AbortSignal,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  consume: (output: Readable) => Promise<T>,
): Promise<T> {
  checkCancelled(signal);
  let child: Child;
  try {
    child = runtime.start(command, args, env);
  } catch {
    throw new BackupError("BACKUP_CLIENT_FAILED");
  }
  let closed = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (closed || forceKill) return;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => {
      if (!closed) child.kill("SIGKILL");
    }, runtime.killGraceMs);
  };
  let startFailed = false;
  child.once("error", () => {
    startFailed = true;
  });
  const completion = new Promise<number | null>((resolve) => {
    child.once("close", (code) => {
      closed = true;
      clearTimeout(forceKill);
      resolve(code);
    });
  });
  child.stderr.resume();
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const result = await consume(child.stdout);
    const code = await completion;
    checkCancelled(signal);
    if (startFailed || code !== 0)
      throw new BackupError("BACKUP_CLIENT_FAILED");
    return result;
  } catch (error) {
    if (startFailed) throw new BackupError("BACKUP_CLIENT_FAILED");
    throw error;
  } finally {
    stop();
    await completion;
    signal.removeEventListener("abort", stop);
    clearTimeout(forceKill);
  }
}

async function smallOutput(output: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of output) {
    bytes += chunk.length;
    if (bytes > 4_096) throw new BackupError("BACKUP_CLIENT_OUTPUT_INVALID");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function clientVersion(
  runtime: CaptureRuntime,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
) {
  let version = "";
  for (const command of ["pg_dump", "pg_restore"]) {
    const output = await runClient(
      runtime,
      signal,
      command,
      ["--version"],
      env,
      smallOutput,
    );
    const match = output.match(
      new RegExp(`^${command} \\(PostgreSQL\\) (17\\.[0-9]+)(?:[ \\r\\n]|$)`),
    );
    if (!match)
      throw new BackupError("BACKUP_POSTGRES_CLIENT_VERSION_MISMATCH");
    if (command === "pg_dump") version = match[1];
  }
  return version;
}

// Both definitions and data entries must exist; a firm/schema-only export cannot pass.
const requiredTables = [
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

async function checkArchiveList(output: Readable) {
  const definitions = new Set<string>(),
    data = new Set<string>();
  let pending = "",
    bytes = 0;
  const line = (text: string) => {
    const entry = text.match(
      /^\d+;\s+\d+\s+\d+\s+(TABLE(?: DATA)?)\s+(\S+)\s+(\S+)(?:\s|$)/,
    );
    if (entry)
      (entry[1] === "TABLE" ? definitions : data).add(
        `${entry[2]}.${entry[3]}`,
      );
  };
  for await (const chunk of output) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024)
      throw new BackupError("BACKUP_ARCHIVE_LIST_TOO_LARGE");
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (pending.length > 16_384 || lines.some((value) => value.length > 16_384))
      throw new BackupError("BACKUP_ARCHIVE_LIST_INVALID");
    for (const value of lines) line(value);
  }
  if (pending) line(pending);
  if (
    requiredTables.some((table) => !definitions.has(table) || !data.has(table))
  )
    throw new BackupError("BACKUP_ARCHIVE_INCOMPLETE");
}

/** Dependencies are injectable for bounded process/disk fault tests without a live database. */
export function createDatabaseCapture(overrides: Partial<CaptureRuntime> = {}) {
  const runtime = { ...defaults, ...overrides };
  return async function capture(input: CaptureInput) {
    let directory: string | undefined;
    const dispose = async () => {
      if (!directory) return;
      try {
        await rm(directory, { recursive: true, force: true });
        directory = undefined;
      } catch {
        throw new BackupError("BACKUP_CAPTURE_CLEANUP_FAILED");
      }
    };
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new BackupError("BACKUP_CAPTURE_TIMEOUT")),
      runtime.timeoutMs,
    );
    const signal = AbortSignal.any([input.signal, deadline.signal]);
    try {
      checkCancelled(signal);
      if (
        !/^[0-9a-f]+-[0-9a-f]+-\d+$/i.test(input.snapshot) ||
        input.snapshot.length > 128
      )
        throw new BackupError("BACKUP_SNAPSHOT_INVALID");
      const env = clientEnvironment(input.databaseUrl);
      const root = runtime.tempRoot();
      await removeAbandonedCaptures(root, runtime, signal);
      if ((await runtime.availableBytes(root)) < 2n * BigInt(MAX_ARCHIVE_BYTES))
        throw new BackupError("BACKUP_DISK_SPACE_LOW");
      checkCancelled(signal);
      const version = await clientVersion(runtime, signal, env);
      directory = await mkdtemp(join(root, capturePrefix));
      await chmod(directory, 0o700);
      await writeFile(
        join(directory, ownerMarker),
        JSON.stringify({
          version: 1,
          pid: process.pid,
          uid: runtime.uid(),
          createdAt: runtime.now(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      const path = join(directory, "database.dump");
      const sha256 = createHash("sha256"),
        md5 = createHash("md5");
      let bytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > runtime.maxBytes)
            return done(new BackupError("BACKUP_ARCHIVE_TOO_LARGE"));
          sha256.update(chunk);
          md5.update(chunk);
          done(null, chunk);
        },
      });
      const args = [
        "--format=custom",
        "--no-password",
        "--lock-wait-timeout=10000",
        `--snapshot=${input.snapshot}`,
      ];
      await runClient(runtime, signal, "pg_dump", args, env, (output) =>
        pipeline(
          output,
          meter,
          createWriteStream(path, { flags: "wx", mode: 0o600, flush: true }),
          { signal },
        ),
      );
      if (!bytes) throw new BackupError("BACKUP_ARCHIVE_EMPTY");
      await runClient(
        runtime,
        signal,
        "pg_restore",
        ["--list", path],
        env,
        checkArchiveList,
      );
      checkCancelled(signal);
      return {
        path,
        bytes,
        sha256: sha256.digest("hex"),
        md5: md5.digest("base64"),
        clientVersion: version,
        dispose,
      };
    } catch (error) {
      await dispose();
      checkCancelled(signal);
      throw error instanceof BackupError
        ? error
        : new BackupError("BACKUP_CAPTURE_FAILED");
    } finally {
      clearTimeout(timer);
    }
  };
}

export const captureDatabase = createDatabaseCapture();

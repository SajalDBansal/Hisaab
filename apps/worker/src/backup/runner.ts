import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  BACKUP_TIMEOUT_MS,
  BackupError,
  backupErrorCode,
  type BackupConfig,
} from "./config";
import { captureDatabase } from "./capture";
import {
  backupClient,
  checkCountDrop,
  finishPublication,
  readState,
  savePending,
  sourceFacts,
} from "./state";
import { createBackupStorage, type BackupStorage } from "./storage";
import {
  backupDue,
  dueOccurrence,
  type Archive,
  type Manifest,
  type PendingPublication,
  type StoredManifest,
} from "./types";

type Log = {
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
};
type RunOptions = { force?: boolean; approveCountDrop?: boolean };

export function assertWriter(
  current: StoredManifest | null,
  config: BackupConfig,
): asserts current is StoredManifest {
  if (!current) throw new BackupError("BACKUP_MANIFEST_MISSING");
  if (current.manifest.writerId !== config.BACKUP_WRITER_ID)
    throw new BackupError("BACKUP_WRITER_CHANGED");
}

// A missing PUT response leaves both archives intact until the exact CAS is resolved.
export async function reconcilePublication(
  storage: BackupStorage,
  pending: PendingPublication,
  signal: AbortSignal,
) {
  const archive = pending.manifest.archive;
  if (!archive) throw new BackupError("BACKUP_MANIFEST_INVALID");
  let current = await storage.read(signal);
  if (current?.manifest.revision === pending.manifest.revision) return current;
  if (current?.etag !== pending.expectedEtag)
    throw new BackupError("BACKUP_PUBLICATION_CONFLICT");
  await storage.verify(archive, signal);
  try {
    await storage.publish(pending.manifest, pending.expectedEtag, signal);
  } catch {
    /* Read back even if the provider committed but its response was lost. */
  }
  current = await storage.read(signal);
  if (current?.manifest.revision !== pending.manifest.revision)
    throw new BackupError("BACKUP_PUBLICATION_UNCERTAIN");
  return current;
}

export function createBackupService(
  config: BackupConfig,
  log: Log,
  dependencies: {
    storage?: BackupStorage;
    capture?: typeof captureDatabase;
    notify?: typeof fetch;
  } = {},
) {
  const shutdown = new AbortController();
  const storage = dependencies.storage ?? createBackupStorage(config);
  const capture = dependencies.capture ?? captureDatabase;
  const notify = dependencies.notify ?? fetch;
  let active: Promise<unknown> | undefined;

  async function run(options: RunOptions = {}) {
    if (active) return { skipped: "already-running" };
    active = runOnce(options);
    try {
      return await active;
    } finally {
      active = undefined;
    }
  }

  async function runOnce(options: RunOptions) {
    const connectionLost = new AbortController();
    const signal = AbortSignal.any([
      shutdown.signal,
      connectionLost.signal,
      AbortSignal.timeout(BACKUP_TIMEOUT_MS),
    ]);
    const client = backupClient(config);
    client.on("error", () => connectionLost.abort());
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lock = false;
    try {
      await client.connect();
      lock = Boolean(
        (
          await client.query(
            "select pg_try_advisory_lock(17491, 3001) as locked",
          )
        ).rows[0]?.locked,
      );
      if (!lock) return { skipped: "another-worker" };
      // Detect loss of the lock connection while pg_dump or R2 is doing long I/O.
      heartbeat = setInterval(() => {
        void client.query("select 1").catch(() => connectionLost.abort());
      }, 10_000);
      const state = await readState(client, config);
      let current = await storage.read(signal);
      assertWriter(current, config);
      if (state.pending) {
        current = await reconcilePublication(storage, state.pending, signal);
        await finishPublication(client, state.pending);
        await finishMaintenance(client, current.manifest, signal);
      }
      if (!options.force && !backupDue(current.manifest.archive))
        return { skipped: "already-current" };
      await client.query(
        "update backup_state set status = 'capturing', last_attempt_at = now(), last_error_code = null where id = 1",
      );
      const pending = await captureAndUpload(client, current, options, signal);
      const archive = pending.manifest.archive;
      if (!archive) throw new BackupError("BACKUP_MANIFEST_INVALID");
      await savePending(client, pending);
      const published = await reconcilePublication(storage, pending, signal);
      signal.throwIfAborted();
      await finishPublication(client, pending);
      await finishMaintenance(client, published.manifest, signal);
      log.info(
        {
          backupId: archive.id,
          bytes: archive.bytes,
        },
        "Database backup published and verified",
      );
      return { completed: archive.id };
    } catch (error) {
      const code = signal.aborted ? "BACKUP_ABORTED" : backupErrorCode(error);
      if (lock) {
        await client.query("rollback").catch(() => undefined);
        await client
          .query(
            "update backup_state set status = 'failed', last_error_code = $1 where id = 1",
            [code],
          )
          .catch(() => undefined);
      }
      log.warn(
        { code },
        "Database backup did not complete; the previous archive is retained",
      );
      throw new BackupError(code);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await client.end().catch(() => undefined);
    }
  }

  async function captureAndUpload(
    client: pg.Client,
    current: StoredManifest,
    options: RunOptions,
    signal: AbortSignal,
  ): Promise<PendingPublication> {
    const id = randomUUID();
    const captureStartedAt = new Date().toISOString();
    await client.query("begin isolation level repeatable read read only");
    const snapshot = (
      await client.query("select pg_export_snapshot() as snapshot")
    ).rows[0]?.snapshot as string;
    const facts = await sourceFacts(client);
    checkCountDrop(
      current.manifest.archive?.counts,
      facts.counts,
      options.approveCountDrop,
    );
    const captured = await capture({
      databaseUrl: config.DATABASE_URL,
      snapshot,
      signal,
    });
    try {
      await client.query("commit");
      const captureFinishedAt = new Date().toISOString();
      const archive: Archive = {
        id,
        key: `installations/${config.BACKUP_INSTALLATION_ID}/archives/${id}.dump`,
        bytes: captured.bytes,
        sha256: captured.sha256,
        captureStartedAt,
        captureFinishedAt,
        verifiedAt: captureFinishedAt,
        publishedAt: captureFinishedAt,
        occurrence: options.force ? "operator" : dueOccurrence(),
        serverVersion: facts.serverVersion,
        clientVersion: captured.clientVersion,
        release: config.SENTRY_RELEASE,
        migrationCount: facts.migrationCount,
        migrationHash: facts.migrationHash,
        counts: facts.counts,
        coverage: "whole-database-v1; attachments-metadata-only",
        verification: "download-sha256-and-archive-list",
      };
      await storage.upload(captured.path, archive, captured.md5, signal);
      await storage.verify(archive, signal);
      archive.verifiedAt = new Date().toISOString();
      archive.publishedAt = archive.verifiedAt;
      return {
        expectedEtag: current.etag,
        cleanupIds: facts.cleanupIds,
        manifest: {
          version: 1,
          installationId: config.BACKUP_INSTALLATION_ID,
          writerId: config.BACKUP_WRITER_ID,
          revision: randomUUID(),
          archive,
        },
      };
    } finally {
      await captured.dispose();
    }
  }

  async function tidy(manifest: Manifest, signal: AbortSignal) {
    try {
      await storage.cleanup(manifest, signal);
    } catch {
      log.warn(
        { code: "BACKUP_CLEANUP_PENDING" },
        "Verified backup retained; obsolete archive cleanup will retry after the next publication",
      );
      return "BACKUP_CLEANUP_PENDING";
    }
    return null;
  }

  async function pingMonitor(archive: Archive | null, signal: AbortSignal) {
    if (!config.BACKUP_HEARTBEAT_URL || backupDue(archive)) return null;
    for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
      try {
        const response = await notify(config.BACKUP_HEARTBEAT_URL, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
        await response.body?.cancel();
        if (response.ok) return null;
      } catch {
        // A brief monitor outage gets one bounded retry without replacing the backup.
      }
    }
    log.warn(
      { code: "BACKUP_HEARTBEAT_FAILED" },
      "Backup succeeded but its external success notification failed",
    );
    return "BACKUP_HEARTBEAT_FAILED";
  }

  // Keep operational failures visible while preserving the successful archive status.
  async function finishMaintenance(
    client: pg.Client,
    manifest: Manifest,
    signal: AbortSignal,
  ) {
    const cleanup = await tidy(manifest, signal);
    const monitor = await pingMonitor(manifest.archive, signal);
    const problems = [cleanup, monitor].filter(Boolean).join(",");
    await client.query(
      "update backup_state set last_error_code = $1 where id = 1",
      [problems || null],
    );
  }

  return {
    run,
    abort: () => shutdown.abort(),
    async close() {
      shutdown.abort();
      await active?.catch(() => undefined);
      storage.close();
    },
  };
}

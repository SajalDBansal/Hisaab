import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import { BACKUP_TIMEOUT_MS, BackupError, type BackupConfig } from "./config";
import { sourceFacts } from "./state";
import type { BackupStorage } from "./storage";
import { backupDue, type Manifest, type StoredManifest } from "./types";

export type OperatorCommand =
  | { kind: "status" }
  | { kind: "initialize" }
  | { kind: "run"; approveCountDrop: boolean }
  | { kind: "adopt"; previousWriterId: string; backupId: string };
type OwnershipCommand = Exclude<OperatorCommand, { kind: "run" }>;
type OperatorContext = {
  client: pg.Client;
  storage: BackupStorage;
  config: BackupConfig;
  enabled: boolean;
  signal: AbortSignal;
};
type StateRow = {
  installation_id: string;
  writer_id: string;
  status: string;
  last_published: unknown;
  pending_publication: unknown;
  last_attempt_at: Date | null;
  last_error_code: string | null;
};

export function parseOperatorCommand(args: string[]): OperatorCommand {
  const [kind, argument, confirmation] = args;
  if ((kind === "status" || kind === "initialize") && args.length === 1)
    return { kind };
  if (
    kind === "run" &&
    args.length <= 2 &&
    (!argument || argument === "--approve-count-drop")
  )
    return { kind, approveCountDrop: argument === "--approve-count-drop" };
  if (kind === "adopt" && args.length === 3 && argument && confirmation)
    return { kind, previousWriterId: argument, backupId: confirmation };
  throw new BackupError(
    "Usage: backup initialize | status | run [--approve-count-drop] | adopt <previous-writer-id> <restored-backup-id>",
  );
}

// Adoption downloads the retained archive; the smaller status/init actions need one minute.
export const operatorTimeoutMs = (command: OwnershipCommand) =>
  command.kind === "adopt" ? BACKUP_TIMEOUT_MS : 60_000;

function statusOf(
  context: OperatorContext,
  row: StateRow | undefined,
  current: StoredManifest | null,
) {
  return {
    enabled: context.enabled,
    databaseInitialized: !!row,
    installationMatches:
      row?.installation_id === context.config.BACKUP_INSTALLATION_ID,
    writerMatches:
      row?.writer_id === context.config.BACKUP_WRITER_ID &&
      current?.manifest.writerId === context.config.BACKUP_WRITER_ID,
    status: row?.status ?? "not-initialized",
    lastAttemptAt: row?.last_attempt_at,
    lastErrorCode: row?.last_error_code,
    publicationPending: !!row?.pending_publication,
    backupId: current?.manifest.archive?.id,
    capturedAt: current?.manifest.archive?.captureStartedAt,
    overdue: backupDue(current?.manifest.archive ?? null),
    externalMonitorConfigured: !!context.config.BACKUP_HEARTBEAT_URL,
  };
}

async function consistentFacts(client: pg.Client) {
  await client.query("begin isolation level repeatable read read only");
  try {
    const facts = await sourceFacts(client);
    await client.query("commit");
    return facts;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

// A response can be lost after R2 commits. Only exact read-back establishes success.
async function publishVerified(
  context: OperatorContext,
  manifest: Manifest,
  expectedEtag: string | null,
) {
  try {
    await context.storage.publish(manifest, expectedEtag, context.signal);
  } catch {
    /* Read-back resolves a possibly committed conditional write. */
  }
  context.signal.throwIfAborted();
  const saved = await context.storage.read(context.signal);
  if (!saved || !isDeepStrictEqual(saved.manifest, manifest))
    throw new BackupError("BACKUP_PUBLICATION_UNCERTAIN");
  return saved;
}

async function initialize(
  context: OperatorContext,
  row: StateRow | undefined,
  current: StoredManifest | null,
  facts: Awaited<ReturnType<typeof sourceFacts>>,
) {
  const { client, config } = context;
  if (facts.counts.users === 0 || facts.counts.firms === 0)
    throw new BackupError("BACKUP_EMPTY_DATABASE");
  if (!current && (row?.last_published || row?.pending_publication))
    throw new BackupError("BACKUP_MANIFEST_MISSING");
  if (row && row.writer_id !== config.BACKUP_WRITER_ID)
    throw new BackupError("BACKUP_DATABASE_IDENTITY_MISMATCH");
  if (current) {
    if (current.manifest.writerId !== config.BACKUP_WRITER_ID)
      throw new BackupError("BACKUP_WRITER_CHANGED");
    if (!row && current.manifest.archive)
      throw new BackupError("USE_ADOPT_FOR_RESTORED_DATABASE");
  } else {
    await publishVerified(
      context,
      {
        version: 1,
        installationId: config.BACKUP_INSTALLATION_ID,
        writerId: config.BACKUP_WRITER_ID,
        revision: randomUUID(),
        archive: null,
      },
      null,
    );
  }
  context.signal.throwIfAborted();
  await client.query(
    "insert into backup_state (id, installation_id, writer_id) values (1, $1, $2) on conflict (id) do nothing",
    [config.BACKUP_INSTALLATION_ID, config.BACKUP_WRITER_ID],
  );
  return "Backup installation initialized. Publication remains disabled until BACKUP_ENABLED=true.";
}

async function adopt(
  context: OperatorContext,
  command: Extract<OwnershipCommand, { kind: "adopt" }>,
  row: StateRow | undefined,
  current: StoredManifest | null,
  facts: Awaited<ReturnType<typeof sourceFacts>>,
) {
  const { client, config, storage, signal } = context;
  if (!row || !current?.manifest.archive)
    throw new BackupError("BACKUP_ADOPTION_CONFIRMATION_REQUIRED");
  const allowed = [command.previousWriterId, config.BACKUP_WRITER_ID];
  if (
    command.previousWriterId === config.BACKUP_WRITER_ID ||
    !allowed.includes(row.writer_id) ||
    !allowed.includes(current.manifest.writerId)
  )
    throw new BackupError("BACKUP_PREVIOUS_WRITER_MISMATCH");
  if (
    current.manifest.archive.id !== command.backupId ||
    facts.migrationHash !== current.manifest.archive.migrationHash ||
    !isDeepStrictEqual(facts.counts, current.manifest.archive.counts)
  )
    throw new BackupError("BACKUP_RESTORED_DATABASE_MISMATCH");
  await storage.verify(current.manifest.archive, signal);
  signal.throwIfAborted();
  // A retry after a lost response or local DB failure reuses the already adopted revision.
  const adopted =
    current.manifest.writerId === config.BACKUP_WRITER_ID
      ? current
      : await publishVerified(
          context,
          {
            ...current.manifest,
            writerId: config.BACKUP_WRITER_ID,
            revision: randomUUID(),
          },
          current.etag,
        );
  signal.throwIfAborted();
  await client.query(
    "update backup_state set writer_id = $1, last_published = $2::jsonb, pending_publication = null, status = 'adopted', last_error_code = null where id = 1",
    [config.BACKUP_WRITER_ID, JSON.stringify(adopted.manifest)],
  );
  return "Writer handover complete. Keep publication disabled until restore checks and RECOVERY_EPOCH rotation are complete.";
}

// These actions have no HTTP route; the CLI supplies a connected, private operator client.
export async function runOperatorAction(
  command: OwnershipCommand,
  context: OperatorContext,
) {
  if (command.kind !== "status" && context.enabled)
    throw new BackupError("DISABLE_BACKUP_BEFORE_OWNERSHIP_CHANGE");
  const lost = new AbortController();
  const signal = AbortSignal.any([
    context.signal,
    lost.signal,
    AbortSignal.timeout(operatorTimeoutMs(command)),
  ]);
  const onError = () => lost.abort();
  const { client, storage, config } = context;
  client.on("error", onError);
  let locked = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    signal.throwIfAborted();
    locked = !!(
      await client.query("select pg_try_advisory_lock(17491, 3001) as locked")
    ).rows[0]?.locked;
    if (!locked) throw new BackupError("BACKUP_ALREADY_RUNNING");
    heartbeat = setInterval(() => {
      void client.query("select 1").catch(onError);
    }, 10_000);
    const current = await storage.read(signal);
    if (
      current &&
      current.manifest.installationId !== config.BACKUP_INSTALLATION_ID
    )
      throw new BackupError("BACKUP_MANIFEST_INVALID");
    const row = (
      await client.query<StateRow>("select * from backup_state where id = 1")
    ).rows[0];
    if (command.kind === "status") return statusOf(context, row, current);
    if (row && row.installation_id !== config.BACKUP_INSTALLATION_ID)
      throw new BackupError("BACKUP_DATABASE_IDENTITY_MISMATCH");
    const facts = await consistentFacts(client);
    signal.throwIfAborted();
    const guarded = { ...context, signal };
    return command.kind === "initialize"
      ? await initialize(guarded, row, current, facts)
      : await adopt(guarded, command, row, current, facts);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    client.off("error", onError);
    if (locked)
      await client
        .query("select pg_advisory_unlock(17491, 3001)")
        .catch(() => undefined);
  }
}

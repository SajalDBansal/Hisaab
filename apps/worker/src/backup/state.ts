import { createHash } from "node:crypto";
import { DeadlineClient } from "@repo/backend/db/deadline-client";
import type pg from "pg";
import { z } from "zod";
import { BackupError, type BackupConfig } from "./config";
import { Counts, Manifest, type PendingPublication } from "./types";

const Pending = z
  .object({
    expectedEtag: z.string(),
    manifest: Manifest,
    cleanupIds: z.array(z.uuid()).max(10_000),
  })
  .strict();

export function backupClient(config: BackupConfig) {
  return new DeadlineClient({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    query_timeout: 35_000,
    statement_timeout: 30_000,
    lock_timeout: 5_000,
    // A read-only exported snapshot must remain alive while pg_dump imports it.
    idle_in_transaction_session_timeout: 25 * 60_000,
    options: "-c transaction_timeout=1500000",
    application_name: "hisaab-backup",
  });
}

export async function readState(client: pg.Client, config: BackupConfig) {
  const row = (await client.query("select * from backup_state where id = 1"))
    .rows[0];
  if (!row) throw new BackupError("BACKUP_NOT_INITIALIZED");
  if (
    row.installation_id !== config.BACKUP_INSTALLATION_ID ||
    row.writer_id !== config.BACKUP_WRITER_ID
  )
    throw new BackupError("BACKUP_DATABASE_IDENTITY_MISMATCH");
  return {
    status: row.status as string,
    lastAttemptAt: row.last_attempt_at as Date | null,
    lastErrorCode: row.last_error_code as string | null,
    lastPublished: row.last_published
      ? Manifest.parse(row.last_published)
      : null,
    pending: row.pending_publication
      ? Pending.parse(row.pending_publication)
      : null,
  };
}

// These counts and migration facts are read from the same exported dump snapshot.
export async function sourceFacts(client: pg.Client) {
  const result = await client.query(`select
    (select count(*)::int from "user") as users,
    (select count(*)::int from organization) as firms,
    (select count(*)::int from vouchers) as vouchers,
    (select count(*)::int from postings) as postings,
    (select count(*)::int from documents) as documents`);
  const counts = Counts.parse(result.rows[0]);
  if (!counts.users || !counts.firms)
    throw new BackupError("BACKUP_EMPTY_DATABASE");
  const migrations = (
    await client.query(
      "select hash, created_at from drizzle.__drizzle_migrations order by id",
    )
  ).rows;
  if (!migrations.length) throw new BackupError("BACKUP_MIGRATIONS_MISSING");
  const version = (await client.query("show server_version")).rows[0]
    ?.server_version as string;
  if (!version?.startsWith("17."))
    throw new BackupError("BACKUP_POSTGRES_VERSION_MISMATCH");
  const cleanupIds = (
    await client.query(`select c.document_id from document_cleanup c
    join documents d on d.id = c.document_id and d.firm_id = c.firm_id
    where d.deleted_at is not null and d.s3_key = c.object_key
      and c.backup_safe_at is null and c.completed_at is null
    order by c.document_id limit 10000`)
  ).rows.map((row) => row.document_id as string);
  return {
    counts,
    cleanupIds,
    serverVersion: version,
    migrationCount: migrations.length,
    migrationHash: createHash("sha256")
      .update(JSON.stringify(migrations))
      .digest("hex"),
  };
}

export function checkCountDrop(
  previous: Counts | undefined,
  current: Counts,
  approved = false,
) {
  if (approved || !previous) return;
  for (const key of Object.keys(current) as (keyof Counts)[])
    if (previous[key] > 0 && current[key] < previous[key] * 0.8)
      throw new BackupError("BACKUP_COUNT_DROP_REQUIRES_REVIEW");
}

export async function savePending(
  client: pg.Client,
  pending: PendingPublication,
) {
  await client.query(
    "update backup_state set pending_publication = $1::jsonb, status = 'publishing' where id = 1",
    [JSON.stringify(pending)],
  );
}

// Only deletions visible inside the successful dump snapshot may release R2 objects.
export async function finishPublication(
  client: pg.Client,
  pending: PendingPublication,
) {
  await client.query("begin");
  try {
    await client.query(
      "update backup_state set last_published = $1::jsonb, pending_publication = null, status = 'completed', last_error_code = null where id = 1",
      [JSON.stringify(pending.manifest)],
    );
    if (pending.cleanupIds.length)
      await client.query(
        "update document_cleanup set backup_safe_at = now(), backup_id = $2 where document_id = any($1::uuid[]) and backup_safe_at is null",
        [pending.cleanupIds, pending.manifest.archive?.id],
      );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

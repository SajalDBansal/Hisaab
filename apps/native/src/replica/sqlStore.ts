import type { ReplicaKind, ReplicaMeta, ReplicaStore } from "@repo/core";

/** The parts of an expo-sqlite database this uses (tests pass bun:sqlite). */
export interface SqlConnection {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: (string | number)[]): Promise<unknown>;
  getAllAsync<T>(source: string, ...params: (string | number)[]): Promise<T[]>;
  withExclusiveTransactionAsync(
    task: (txn: SqlConnection) => Promise<void>,
  ): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS replica_rows (
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (owner, kind, id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS replica_meta (
  owner TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL
);`;

/**
 * The books on the phone in SQLite: one row per party, item and voucher, so a
 * sync writes only what changed. Each sync is one exclusive transaction: the
 * rows and the new cursor are saved together, or not at all.
 */
export function sqlReplicaStore(
  connect: () => Promise<SqlConnection>,
): ReplicaStore {
  let ready: Promise<SqlConnection> | null = null;
  const db = () =>
    (ready ??= connect().then(async (conn) => {
      await conn.execAsync(SCHEMA);
      return conn;
    }));
  return {
    async read(owner) {
      const conn = await db();
      const [meta] = await conn.getAllAsync<{ json: string }>(
        "SELECT json FROM replica_meta WHERE owner = ?",
        owner,
      );
      const rows = await conn.getAllAsync<{ kind: ReplicaKind; json: string }>(
        "SELECT kind, json FROM replica_rows WHERE owner = ?",
        owner,
      );
      return {
        meta: meta ? (JSON.parse(meta.json) as ReplicaMeta) : null,
        rows,
      };
    },
    async write(owner, batch) {
      const conn = await db();
      await conn.withExclusiveTransactionAsync(async (txn) => {
        if (batch.reset)
          await txn.runAsync("DELETE FROM replica_rows WHERE owner = ?", owner);
        for (const row of batch.upserts)
          await txn.runAsync(
            "INSERT OR REPLACE INTO replica_rows (owner, kind, id, json) VALUES (?, ?, ?, ?)",
            owner,
            row.kind,
            row.id,
            row.json,
          );
        for (const row of batch.removes)
          await txn.runAsync(
            "DELETE FROM replica_rows WHERE owner = ? AND kind = ? AND id = ?",
            owner,
            row.kind,
            row.id,
          );
        await txn.runAsync(
          "INSERT OR REPLACE INTO replica_meta (owner, json) VALUES (?, ?)",
          owner,
          JSON.stringify(batch.meta),
        );
      });
    },
    async clear(owner) {
      const conn = await db();
      await conn.withExclusiveTransactionAsync(async (txn) => {
        if (owner) {
          await txn.runAsync("DELETE FROM replica_rows WHERE owner = ?", owner);
          await txn.runAsync("DELETE FROM replica_meta WHERE owner = ?", owner);
        } else {
          await txn.runAsync("DELETE FROM replica_rows");
          await txn.runAsync("DELETE FROM replica_meta");
        }
      });
    },
  };
}

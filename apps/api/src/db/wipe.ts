import { sql } from "drizzle-orm";
import type { Db } from "@repo/backend/db/client";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Wiping is only for a disposable database on this machine. NODE_ENV alone is not
// enough: a production DATABASE_URL pasted into a dev shell must still be refused.
// Set ALLOW_DB_WIPE=yes to wipe a disposable database on another host (e.g. a container).
export function assertDisposableDatabase(url: string) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to wipe a database in production.");
  if (process.env.ALLOW_DB_WIPE === "yes") return;
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host))
    throw new Error(
      `Refusing to wipe the database on "${host}". Only local databases can be wiped; set ALLOW_DB_WIPE=yes if this one is disposable.`,
    );
}

// Empties every table in the public schema and restarts their ids. The schema and the
// migration history (drizzle schema) stay, so no re-migration is needed afterwards.
// Append-only tables (audit_log, loan_events, settlements, ...) block deletes and truncates
// with a trigger, so their user triggers are paused for the wipe. It all runs in one
// transaction: if anything fails, nothing is wiped and every guard stays on.
export async function wipeDatabase(db: Db) {
  return db.transaction(async (tx) => {
    const tables = await tx.execute<{ name: string }>(sql`
      select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`);
    const guarded = await tx.execute<{ name: string }>(sql`
      select distinct quote_ident(c.relname) as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D'`);
    if (tables.rows.length === 0) return 0;

    for (const { name } of guarded.rows)
      await tx.execute(sql.raw(`alter table ${name} disable trigger user`));
    await tx.execute(
      sql.raw(
        `truncate table ${tables.rows.map((t) => t.name).join(", ")} restart identity cascade`,
      ),
    );
    for (const { name } of guarded.rows)
      await tx.execute(sql.raw(`alter table ${name} enable trigger user`));
    return tables.rows.length;
  });
}

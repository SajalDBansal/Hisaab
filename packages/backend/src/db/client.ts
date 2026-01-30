import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

/**
 * One connection pool and one Drizzle instance for the whole process.
 * Around 10 connections per server instance; put RDS Proxy or PgBouncer in front when there are many instances.
 */
export function createDb(
  databaseUrl: string,
  options: { max?: number; connectionTimeoutMillis?: number } = {},
) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
export { schema };

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";
import { DeadlineClient } from "./deadline-client";

type DatabaseOptions = {
  max?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  queryTimeoutMillis?: number;
  lockTimeoutMillis?: number;
  transactionTimeoutMillis?: number;
  workload?: "application" | "maintenance";
};

/**
 * One connection pool and one Drizzle instance for the whole process.
 * Around 10 connections per server instance; put RDS Proxy or PgBouncer in front when there are many instances.
 */
export function createDb(databaseUrl: string, options: DatabaseOptions = {}) {
  const maintenance = options.workload === "maintenance";
  const statementTimeout =
    options.statementTimeoutMillis ?? (maintenance ? 120_000 : 30_000);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    Client: DeadlineClient,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    statement_timeout: statementTimeout,
    query_timeout: options.queryTimeoutMillis ?? statementTimeout + 5_000,
    lock_timeout: options.lockTimeoutMillis ?? (maintenance ? 10_000 : 5_000),
    idle_in_transaction_session_timeout: 30_000,
    // Paginated imports/exports may span many short statements, up to five minutes.
    options: `-c transaction_timeout=${options.transactionTimeoutMillis ?? 300_000}`,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Probe limits stay separate from business queries and long-running exports. */
export function createReadinessPool(databaseUrl: string) {
  return new pg.Pool({
    connectionString: databaseUrl,
    Client: DeadlineClient,
    max: 1,
    connectionTimeoutMillis: 1_000,
    query_timeout: 1_000,
    statement_timeout: 1_000,
    idleTimeoutMillis: 10_000,
  });
}

export type Db = ReturnType<typeof createDb>["db"];
export { schema };

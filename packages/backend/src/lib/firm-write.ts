import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Master validation and changes must use the same lock as voucher posting.
export function withFirmWrite<T>(
  db: Db,
  firmId: string,
  work: (tx: Transaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
    );
    return work(tx);
  });
}

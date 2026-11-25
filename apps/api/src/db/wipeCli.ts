import { createDb } from "@repo/backend/db/client";
import { assertDisposableDatabase, wipeDatabase } from "./wipe";

// Fresh start: empties every table in a local database (users, firms, books, everything).
// The schema and migrations stay; run db:seed afterwards if you want the demo firms.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
assertDisposableDatabase(url);

const { db, pool } = createDb(url, { max: 1, workload: "maintenance" });
try {
  const count = await wipeDatabase(db);
  console.log(`Wiped ${count} tables. The database is empty.`);
} finally {
  await pool.end();
}

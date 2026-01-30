import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@repo/backend/db/client";
import { backfillVoucherSnapshots } from "./backfillSnapshots";

// Applies every migration that hasn't run yet. Running it twice does nothing the second time.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

const { db, pool } = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await backfillVoucherSnapshots(db);
} finally {
  await pool.end();
}
console.log("Migrations applied.");

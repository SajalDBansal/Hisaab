import fs from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "@repo/backend/db/client";
import { backfillVoucherSnapshots } from "./backfillSnapshots";

// Applies every migration that hasn't run yet. Running it twice does nothing the second time.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

const migrationsFolder = fs.existsSync("./src/db/migrations")
  ? "./src/db/migrations"
  : "./apps/api/src/db/migrations";

const { db, pool } = createDb(url, { max: 1, workload: "maintenance" });
try {
  await migrate(db, { migrationsFolder });
  await backfillVoucherSnapshots(db);
} finally {
  await pool.end();
}
console.log("Migrations applied.");

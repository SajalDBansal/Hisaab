import { buildSeed, secondDemoFirm } from "@repo/core";
import { createDb, schema } from "@repo/backend/db/client";
import { insertFirm } from "./seedFirm";
import { assertDisposableDatabase, wipeDatabase } from "./wipe";

// Fills a local database with the same demo firms the app shows today.
// Safe to run again: it wipes the whole database first, so never point it at real books.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
assertDisposableDatabase(url);

const { db, pool } = createDb(url, { max: 2, workload: "maintenance" });
try {
  await wipeDatabase(db);

  const [owner] = await db
    .insert(schema.user)
    .values({
      name: "Demo Owner",
      email: "owner@hisaab.test",
      emailVerified: true,
      phoneNumber: "+919837045120",
      phoneNumberVerified: true,
    })
    .returning();
  if (!owner) throw new Error("Could not create the demo user");

  const first = await insertFirm(db, buildSeed(), owner.id);
  const second = await insertFirm(db, secondDemoFirm(), owner.id);

  console.log(`Seeded 2 demo firms for ${owner.email}:\n  ${first}\n  ${second}`);
} finally {
  await pool.end();
}

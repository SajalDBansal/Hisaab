import { buildSeed, secondDemoFirm } from "@repo/core";
import { sql } from "drizzle-orm";
import { createDb, schema } from "@repo/backend/db/client";
import { insertFirm } from "./seedFirm";

// Fills a local database with the same demo firms the app shows today.
// Safe to run again: it wipes the demo rows first (never run it on a real database).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
if (process.env.NODE_ENV === "production")
  throw new Error("Refusing to seed in production.");

const { db, pool } = createDb(url, { max: 2 });

// The edit log is append-only, so clearing it means dropping its trigger for a moment
await db.execute(sql`alter table audit_log disable trigger user`);
await db.execute(
  sql`truncate table "organization", "user" restart identity cascade`,
);
await db.execute(sql`alter table audit_log enable trigger user`);

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
await pool.end();

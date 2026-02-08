import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { moment, primaryId } from "./columns";

// Ephemeral authentication material: exclude all rows from operational archives.
export const recoveryIdentityTickets = pgTable(
  "recovery_identity_tickets",
  {
    id: primaryId().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    archiveDigest: text("archive_digest").notNull(),
    evidence: text("evidence").notNull(),
    expiresAt: moment("expires_at").notNull(),
    consumedAt: moment("consumed_at"),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("recovery_identity_user_idx").on(t.userId),
    check(
      "recovery_identity_hash_check",
      sql`${t.tokenHash} ~ '^[a-f0-9]{64}$' AND ${t.archiveDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "recovery_identity_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`,
    ),
  ],
);

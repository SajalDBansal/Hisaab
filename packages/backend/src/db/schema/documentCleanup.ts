import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { moment } from "./columns";
import { documents } from "./system";

// Deleting a document and scheduling its eventual object removal commit together.
export const documentCleanup = pgTable(
  "document_cleanup",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "restrict" }),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    objectKey: text("object_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    deletedAt: moment("deleted_at").notNull(),
    backupSafeAt: moment("backup_safe_at"),
    backupId: text("backup_id"),
    completedAt: moment("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: moment("next_attempt_at").notNull().defaultNow(),
    leaseUntil: moment("lease_until"),
    leaseToken: uuid("lease_token"),
    lastErrorCode: text("last_error_code"),
  },
  (t) => [
    index("document_cleanup_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.completedAt} is null`),
  ],
);

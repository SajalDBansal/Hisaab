import { check, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { moment } from "./columns";

// Installation-wide state is accessible only to the host backup operator.
export const backupState = pgTable(
  "backup_state",
  {
    id: integer("id").primaryKey().default(1),
    installationId: text("installation_id").notNull(),
    writerId: text("writer_id").notNull(),
    status: text("status").notNull().default("initialized"),
    lastPublished: jsonb("last_published"),
    pendingPublication: jsonb("pending_publication"),
    lastAttemptAt: moment("last_attempt_at"),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [check("backup_state_singleton", sql`${table.id} = 1`)],
);

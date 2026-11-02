CREATE TABLE "backup_state" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "installation_id" text NOT NULL,
  "writer_id" text NOT NULL,
  "status" text DEFAULT 'initialized' NOT NULL,
  "last_published" jsonb,
  "pending_publication" jsonb,
  "last_attempt_at" timestamptz,
  "last_error_code" text,
  CONSTRAINT "backup_state_singleton" CHECK ("id" = 1)
);

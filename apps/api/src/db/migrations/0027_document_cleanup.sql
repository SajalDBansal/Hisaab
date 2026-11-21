-- Keep objects until a published database backup contains their deletion.
CREATE TABLE document_cleanup (
  document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE RESTRICT,
  firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  object_key text NOT NULL,
  thumbnail_key text,
  deleted_at timestamptz NOT NULL,
  backup_safe_at timestamptz,
  backup_id text,
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code text
);
--> statement-breakpoint
CREATE INDEX document_cleanup_pending_idx ON document_cleanup(next_attempt_at)
WHERE completed_at IS NULL;

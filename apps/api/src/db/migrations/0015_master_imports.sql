CREATE TABLE master_import_batches (
  id uuid PRIMARY KEY,
  firm_id uuid NOT NULL CONSTRAINT master_import_batches_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  request_key uuid NOT NULL,
  file_hash text NOT NULL,
  kind text NOT NULL,
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL,
  CONSTRAINT master_import_batches_kind_check CHECK (kind IN ('customers', 'suppliers', 'items'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX master_import_batches_user_key_idx ON master_import_batches(user_id, request_key);
CREATE INDEX master_import_batches_firm_idx ON master_import_batches(firm_id, applied_at);

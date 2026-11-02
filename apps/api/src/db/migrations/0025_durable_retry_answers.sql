-- Retain every saved write answer, including settlement records and sync envelopes.
CREATE OR REPLACE FUNCTION "retain_book_operation_answer"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO operation_receipts (user_id, key, request_hash, legacy, result, created_at)
  VALUES (NEW.user_id, NEW.key, NEW.request_hash, 1,
    jsonb_build_object('state','committed','response',NEW.response), NEW.created_at)
  ON CONFLICT (user_id, key) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Preserve remaining old answers before the worker is allowed to remove their cache copies.
INSERT INTO operation_receipts (user_id, key, request_hash, legacy, result, created_at)
SELECT user_id, key, request_hash, 1,
  jsonb_build_object('state','committed','response',response), created_at
FROM idempotency_keys
ON CONFLICT (user_id, key) DO NOTHING;

ALTER TABLE "vouchers" ADD COLUMN "snapshot" jsonb;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_sync_change()
RETURNS trigger AS $$
DECLARE
  new_data jsonb;
  next_action sync_action := 'upsert';
  next_firm_id uuid;
  next_entity_id uuid;
BEGIN
  new_data := to_jsonb(NEW);

  IF new_data ? 'deleted_at' AND new_data->>'deleted_at' IS NOT NULL THEN
    next_action := 'deleted';
  END IF;

  next_firm_id := COALESCE(new_data->>'firm_id', new_data->>'id')::uuid;
  next_entity_id := COALESCE(new_data->>'id', new_data->>'firm_id')::uuid;

  -- Allocate this firm's sequence numbers in commit order, including non-voucher writes.
  PERFORM pg_advisory_xact_lock(hashtextextended(next_firm_id::text, 1));
  INSERT INTO change_log (firm_id, entity, entity_id, action)
  VALUES (next_firm_id, TG_ARGV[0]::sync_entity, next_entity_id, next_action);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

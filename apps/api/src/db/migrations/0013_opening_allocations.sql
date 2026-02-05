ALTER TABLE parties ADD COLUMN opening_gst_balance bigint;
ALTER TABLE ledgers ADD COLUMN opening_gst_balance bigint;
ALTER TABLE accounts ADD COLUMN opening_gst_balance bigint;
ALTER TABLE opening_accounts ADD COLUMN opening_gst_amount bigint;
--> statement-breakpoint
ALTER TABLE parties ADD CONSTRAINT parties_opening_gst_check CHECK (opening_gst_balance BETWEEN least(0, opening_balance) AND greatest(0, opening_balance));
ALTER TABLE ledgers ADD CONSTRAINT ledgers_opening_gst_check CHECK (opening_gst_balance BETWEEN least(0, opening_balance) AND greatest(0, opening_balance));
ALTER TABLE accounts ADD CONSTRAINT accounts_opening_gst_check CHECK (opening_gst_balance BETWEEN least(0, opening_balance) AND greatest(0, opening_balance));
ALTER TABLE opening_accounts ADD CONSTRAINT opening_accounts_gst_check CHECK (opening_gst_amount BETWEEN least(0, amount) AND greatest(0, amount));
--> statement-breakpoint
-- Allocation edits are opening edits, even when the combined balance stays unchanged.
CREATE FUNCTION protect_opening_allocations() RETURNS trigger AS $$
DECLARE
  field text := CASE WHEN TG_TABLE_NAME = 'opening_accounts' THEN 'opening_gst_amount' ELSE 'opening_gst_balance' END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.firm_id::text, 0));
  IF to_jsonb(OLD)->field IS DISTINCT FROM to_jsonb(NEW)->field AND EXISTS (
    SELECT 1 FROM book_controls WHERE firm_id = NEW.firm_id AND
      (opening_approved_at IS NOT NULL OR closed_through IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0010', MESSAGE = 'Reopen opening balances before changing their book allocation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER parties_protect_allocation BEFORE UPDATE ON parties FOR EACH ROW EXECUTE FUNCTION protect_opening_allocations();
CREATE TRIGGER ledgers_protect_allocation BEFORE UPDATE ON ledgers FOR EACH ROW EXECUTE FUNCTION protect_opening_allocations();
CREATE TRIGGER accounts_protect_allocation BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION protect_opening_allocations();
CREATE TRIGGER opening_accounts_protect_allocation BEFORE UPDATE ON opening_accounts FOR EACH ROW EXECUTE FUNCTION protect_opening_allocations();

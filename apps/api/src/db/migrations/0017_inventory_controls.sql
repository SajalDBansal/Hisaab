ALTER TABLE items ADD COLUMN opening_lots jsonb;
--> statement-breakpoint
ALTER TABLE vouchers ADD COLUMN inventory_adjustment jsonb;
--> statement-breakpoint
CREATE FUNCTION protect_opening_stock_lots() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.firm_id::text, 0));
  IF (TG_OP = 'INSERT' AND NEW.opening_lots IS NOT NULL OR TG_OP = 'UPDATE' AND OLD.opening_lots IS DISTINCT FROM NEW.opening_lots)
    AND EXISTS (SELECT 1 FROM book_controls WHERE firm_id = NEW.firm_id AND (opening_approved_at IS NOT NULL OR closed_through IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0010', MESSAGE = 'Reopen opening balances before changing opening stock lots.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER items_protect_opening_lots BEFORE INSERT OR UPDATE ON items FOR EACH ROW EXECUTE FUNCTION protect_opening_stock_lots();

-- Firm tax treatment assigns shared opening balances to a book category.
CREATE FUNCTION protect_approved_firm_classification() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.firm_id::text, 0));
  IF (OLD.gst_registration, OLD.fy_start, OLD.state_code, OLD.composition_type)
    IS DISTINCT FROM (NEW.gst_registration, NEW.fy_start, NEW.state_code, NEW.composition_type)
    AND EXISTS (SELECT 1 FROM book_controls WHERE firm_id = NEW.firm_id
      AND (opening_approved_at IS NOT NULL OR closed_through IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0010', MESSAGE = 'Reopen opening balances before changing the firm book classification.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER firm_profile_protect_openings BEFORE UPDATE ON firm_profile
FOR EACH ROW EXECUTE FUNCTION protect_approved_firm_classification();

ALTER TABLE master_import_batches DROP CONSTRAINT master_import_batches_kind_check;
--> statement-breakpoint
ALTER TABLE master_import_batches ADD CONSTRAINT master_import_batches_kind_check
CHECK (kind IN ('customers','suppliers','items','opening-balances','open-bills','opening-stock'));
--> statement-breakpoint
CREATE TABLE imported_opening_balances (
  id uuid PRIMARY KEY,
  firm_id uuid NOT NULL CONSTRAINT imported_opening_balances_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  date date NOT NULL,
  amount bigint NOT NULL,
  gst_amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imported_opening_balances_kind_check CHECK (target_kind IN ('party','ledger','account')),
  CONSTRAINT imported_opening_balances_amount_check CHECK (amount <> 0 AND abs(amount) <= 1000000000000 AND gst_amount BETWEEN least(0,amount) AND greatest(0,amount))
);
--> statement-breakpoint
CREATE UNIQUE INDEX imported_opening_balances_target_idx ON imported_opening_balances(firm_id,target_kind,target_id);
--> statement-breakpoint
CREATE TABLE opening_bills (
  id uuid PRIMARY KEY,
  firm_id uuid NOT NULL CONSTRAINT opening_bills_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  party_id uuid NOT NULL CONSTRAINT opening_bills_party_id_parties_id_fk REFERENCES parties(id) ON DELETE RESTRICT,
  number text NOT NULL,
  date date NOT NULL,
  due_date date NOT NULL,
  opening_date date NOT NULL,
  amount bigint NOT NULL,
  gst_amount bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opening_bills_amount_check CHECK (amount > 0 AND amount <= 1000000000000 AND gst_amount BETWEEN 0 AND amount),
  CONSTRAINT opening_bills_date_check CHECK (date <= opening_date AND due_date >= date)
);
--> statement-breakpoint
CREATE UNIQUE INDEX opening_bills_number_idx ON opening_bills(firm_id,party_id,lower(number));
--> statement-breakpoint
CREATE INDEX opening_bills_party_idx ON opening_bills(firm_id,party_id);
--> statement-breakpoint
CREATE FUNCTION reject_opening_import_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported opening allocations are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER imported_opening_balances_immutable BEFORE UPDATE OR DELETE ON imported_opening_balances
FOR EACH ROW EXECUTE FUNCTION reject_opening_import_mutation();
--> statement-breakpoint
CREATE TRIGGER opening_bills_immutable BEFORE UPDATE OR DELETE ON opening_bills
FOR EACH ROW EXECUTE FUNCTION reject_opening_import_mutation();
--> statement-breakpoint
ALTER TABLE allocations ADD COLUMN opening_bill_id uuid
CONSTRAINT allocations_opening_bill_id_opening_bills_id_fk REFERENCES opening_bills(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE allocations DROP CONSTRAINT allocations_target_check;
ALTER TABLE allocations ADD CONSTRAINT allocations_target_check
CHECK (num_nonnulls(bill_id, opening_party_id, opening_bill_id) = 1);
CREATE INDEX allocations_opening_bill_idx ON allocations(firm_id,opening_bill_id);
--> statement-breakpoint
ALTER TABLE settlement_allocations ADD COLUMN opening_bill_id uuid
CONSTRAINT settlement_allocations_opening_bill_id_opening_bills_id_fk REFERENCES opening_bills(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE settlement_allocations DROP CONSTRAINT settlement_allocations_target_check;
ALTER TABLE settlement_allocations ADD CONSTRAINT settlement_allocations_target_check
CHECK (num_nonnulls(bill_id, opening_party_id, opening_bill_id) = 1);
CREATE INDEX settlement_allocations_opening_bill_idx ON settlement_allocations(firm_id,opening_bill_id);
--> statement-breakpoint
CREATE FUNCTION protect_imported_opening_master() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  target text := CASE TG_TABLE_NAME WHEN 'parties' THEN 'party' WHEN 'ledgers' THEN 'ledger' WHEN 'accounts' THEN 'account' ELSE 'item' END;
  protected boolean;
  fields text[];
  field text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.firm_id::text, 0));
  IF target = 'item' THEN
    SELECT EXISTS (
      SELECT 1 FROM master_import_batches b,
      LATERAL jsonb_array_elements(coalesce(b.result->'stockLots', '[]'::jsonb)) lot
      WHERE b.firm_id = OLD.firm_id AND b.kind = 'opening-stock'
        AND lot->>'itemId' = OLD.id::text
    ) INTO protected;
    fields := ARRAY['id','firm_id','deleted_at','unit','opening_stock','opening_cost','opening_book_scope','opening_lots'];
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM imported_opening_balances
      WHERE firm_id = OLD.firm_id AND target_kind = target AND target_id = OLD.id
    ) INTO protected;
    IF target = 'party' THEN
      protected := protected OR EXISTS (
        SELECT 1 FROM opening_bills WHERE firm_id = OLD.firm_id AND party_id = OLD.id
      );
    END IF;
    fields := ARRAY['id','firm_id','deleted_at','type','kind','group_name','opening_balance','opening_gst_balance','opening_date'];
  END IF;
  IF protected THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Imported opening masters cannot be deleted' USING ERRCODE = 'P0021';
    END IF;
    FOREACH field IN ARRAY fields LOOP
      IF old_row->field IS DISTINCT FROM new_row->field THEN
        RAISE EXCEPTION 'Imported opening amounts and allocations are immutable' USING ERRCODE = 'P0021';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parties_protect_imported_opening BEFORE UPDATE OR DELETE ON parties
FOR EACH ROW EXECUTE FUNCTION protect_imported_opening_master();
CREATE TRIGGER ledgers_protect_imported_opening BEFORE UPDATE OR DELETE ON ledgers
FOR EACH ROW EXECUTE FUNCTION protect_imported_opening_master();
CREATE TRIGGER accounts_protect_imported_opening BEFORE UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION protect_imported_opening_master();
CREATE TRIGGER items_protect_imported_opening BEFORE UPDATE OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION protect_imported_opening_master();

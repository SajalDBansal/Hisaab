CREATE TABLE settlement_entries (
 id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
 kind text NOT NULL, voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
 party_id uuid REFERENCES parties(id) ON DELETE RESTRICT,
 source_voucher_id uuid REFERENCES vouchers(id) ON DELETE RESTRICT, source_entry_id uuid,
 loan_id uuid REFERENCES loans(id) ON DELETE RESTRICT,
 interest_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT, installment_number integer,
 date date NOT NULL, book_scope text NOT NULL, amount bigint NOT NULL DEFAULT 0, reason text NOT NULL,
 user_id uuid NOT NULL, user_name text NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL,
 CONSTRAINT settlement_entries_amount_check CHECK (amount > 0 AND amount <= 9007199254740991 AND version = 1),
 CONSTRAINT settlement_entries_scope_check CHECK (book_scope IN ('gst','nongst'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX settlement_entries_voucher_idx ON settlement_entries(voucher_id);
CREATE UNIQUE INDEX settlement_entries_reversal_idx ON settlement_entries(source_entry_id) WHERE kind = 'reversal';
CREATE INDEX settlement_entries_firm_idx ON settlement_entries(firm_id,id);
CREATE INDEX settlement_entries_source_idx ON settlement_entries(firm_id,source_voucher_id);
CREATE INDEX settlement_entries_loan_idx ON settlement_entries(firm_id,loan_id,installment_number);
--> statement-breakpoint
CREATE TABLE settlement_allocations (
 id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
 entry_id uuid NOT NULL REFERENCES settlement_entries(id) ON DELETE RESTRICT,
 voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
 bill_id uuid REFERENCES vouchers(id) ON DELETE RESTRICT,
 opening_party_id uuid REFERENCES parties(id) ON DELETE RESTRICT, amount bigint NOT NULL DEFAULT 0,
 CONSTRAINT settlement_allocations_amount_check CHECK (amount <> 0 AND abs(amount) <= 9007199254740991),
 CONSTRAINT settlement_allocations_target_check CHECK ((bill_id IS NULL) <> (opening_party_id IS NULL))
);
CREATE INDEX settlement_allocations_entry_idx ON settlement_allocations(entry_id);
CREATE INDEX settlement_allocations_voucher_idx ON settlement_allocations(firm_id,voucher_id);
--> statement-breakpoint
CREATE TABLE credit_approvals (
 id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
 party_id uuid NOT NULL REFERENCES parties(id) ON DELETE RESTRICT, party_version integer NOT NULL,
 sale_hash text NOT NULL, credit_limit bigint NOT NULL DEFAULT 0, projected_balance bigint NOT NULL DEFAULT 0,
 reason text NOT NULL, user_id uuid NOT NULL, user_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX credit_approvals_firm_idx ON credit_approvals(firm_id,id);
CREATE TABLE credit_approval_uses (
 id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
 approval_id uuid NOT NULL REFERENCES credit_approvals(id) ON DELETE RESTRICT,
 voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_approval_uses_voucher_idx ON credit_approval_uses(approval_id,voucher_id);
CREATE INDEX credit_approval_uses_approval_idx ON credit_approval_uses(firm_id,approval_id);
--> statement-breakpoint
CREATE FUNCTION settlement_check_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE related_firm uuid;
BEGIN
 IF TG_TABLE_NAME = 'settlement_entries' THEN
  SELECT firm_id INTO related_firm FROM vouchers WHERE id = NEW.voucher_id;
  IF related_firm IS DISTINCT FROM NEW.firm_id THEN RAISE EXCEPTION 'Settlement journal belongs to another firm'; END IF;
  IF NEW.party_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE id=NEW.party_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Settlement party belongs to another firm'; END IF;
  IF NEW.source_voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vouchers WHERE id=NEW.source_voucher_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Settlement source belongs to another firm'; END IF;
  IF NEW.source_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM settlement_entries WHERE id=NEW.source_entry_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Settlement source entry belongs to another firm'; END IF;
  IF NEW.loan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM loans WHERE id=NEW.loan_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Settlement loan belongs to another firm'; END IF;
  IF NEW.interest_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.interest_account_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Interest account belongs to another firm'; END IF;
 ELSIF TG_TABLE_NAME = 'settlement_allocations' THEN
  IF NOT EXISTS (SELECT 1 FROM settlement_entries WHERE id=NEW.entry_id AND firm_id=NEW.firm_id AND voucher_id=NEW.voucher_id) THEN RAISE EXCEPTION 'Allocation entry mismatch'; END IF;
  IF NEW.bill_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vouchers WHERE id=NEW.bill_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Allocation bill belongs to another firm'; END IF;
  IF NEW.opening_party_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parties WHERE id=NEW.opening_party_id AND firm_id=NEW.firm_id) THEN RAISE EXCEPTION 'Allocation opening belongs to another firm'; END IF;
 ELSIF TG_TABLE_NAME = 'credit_approvals' THEN
  IF NOT EXISTS (SELECT 1 FROM parties WHERE id=NEW.party_id AND firm_id=NEW.firm_id AND type='customer') THEN RAISE EXCEPTION 'Credit approval customer mismatch'; END IF;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM credit_approvals a JOIN vouchers v ON v.party_id=a.party_id WHERE a.id=NEW.approval_id AND a.firm_id=NEW.firm_id AND v.id=NEW.voucher_id AND v.firm_id=NEW.firm_id AND v.type='sale') THEN RAISE EXCEPTION 'Credit approval sale mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER settlement_entries_owner BEFORE INSERT ON settlement_entries FOR EACH ROW EXECUTE FUNCTION settlement_check_owner();
CREATE TRIGGER settlement_allocations_owner BEFORE INSERT ON settlement_allocations FOR EACH ROW EXECUTE FUNCTION settlement_check_owner();
CREATE TRIGGER credit_approvals_owner BEFORE INSERT ON credit_approvals FOR EACH ROW EXECUTE FUNCTION settlement_check_owner();
CREATE TRIGGER credit_approval_uses_owner BEFORE INSERT ON credit_approval_uses FOR EACH ROW EXECUTE FUNCTION settlement_check_owner();
CREATE TRIGGER settlement_entries_no_change BEFORE UPDATE OR DELETE ON settlement_entries FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER settlement_allocations_no_change BEFORE UPDATE OR DELETE ON settlement_allocations FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER credit_approvals_no_change BEFORE UPDATE OR DELETE ON credit_approvals FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER credit_approval_uses_no_change BEFORE UPDATE OR DELETE ON credit_approval_uses FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER settlement_entries_no_truncate BEFORE TRUNCATE ON settlement_entries FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER settlement_allocations_no_truncate BEFORE TRUNCATE ON settlement_allocations FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER credit_approvals_no_truncate BEFORE TRUNCATE ON credit_approvals FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER credit_approval_uses_no_truncate BEFORE TRUNCATE ON credit_approval_uses FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint
CREATE FUNCTION settlement_protect_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM settlement_entries WHERE voucher_id=OLD.id OR source_voucher_id=OLD.id)
    OR EXISTS (SELECT 1 FROM settlement_allocations WHERE bill_id=OLD.id) THEN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Use an audited settlement reversal'; END IF;
  IF (to_jsonb(OLD) - ARRAY['version','updated_at','cleared_on','bank_clearings']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['version','updated_at','cleared_on','bank_clearings']) THEN
   RAISE EXCEPTION 'Use an audited settlement reversal or reallocation';
  END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER settlement_voucher_no_rewrite BEFORE UPDATE OR DELETE ON vouchers FOR EACH ROW EXECUTE FUNCTION settlement_protect_voucher();

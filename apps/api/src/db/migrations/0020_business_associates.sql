ALTER TABLE vouchers ADD COLUMN delivery jsonb, ADD COLUMN commission jsonb;

CREATE TABLE associates (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, profile jsonb NOT NULL,
  payable_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX associates_firm_name_idx ON associates(firm_id, name);
CREATE UNIQUE INDEX associates_payable_idx ON associates(firm_id, payable_account_id);
CREATE TABLE associate_fields (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT, definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX associate_fields_firm_idx ON associate_fields(firm_id);
CREATE TABLE associate_rules (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid NOT NULL REFERENCES associates(id) ON DELETE RESTRICT, version integer NOT NULL,
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX associate_rules_version_idx ON associate_rules(firm_id, associate_id, version);
CREATE TABLE delivery_assignments (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid NOT NULL REFERENCES associates(id) ON DELETE RESTRICT, voucher_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
  voucher_number text NOT NULL, date date NOT NULL, snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','dispatched','delivered','failed','returned')),
  status_date date NOT NULL, note text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX delivery_assignments_associate_idx ON delivery_assignments(firm_id, associate_id, date);
CREATE UNIQUE INDEX delivery_assignments_active_idx ON delivery_assignments(firm_id, voucher_id) WHERE active;
CREATE TABLE commission_accruals (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid NOT NULL REFERENCES associates(id) ON DELETE RESTRICT, sale_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
  sale_version integer NOT NULL CHECK (sale_version > 0), line_index integer NOT NULL CHECK (line_index >= 0), book_scope book_scope NOT NULL, date date NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0), basis bigint NOT NULL DEFAULT 0 CHECK (basis BETWEEN 0 AND 9007199254740991),
  earned bigint NOT NULL DEFAULT 0 CHECK (earned BETWEEN 0 AND 9007199254740991), snapshot jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commission_accruals_source_idx ON commission_accruals(firm_id, sale_id, sale_version, line_index);
CREATE INDEX commission_accruals_associate_idx ON commission_accruals(firm_id, associate_id);
CREATE TABLE associate_payouts (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid NOT NULL REFERENCES associates(id) ON DELETE RESTRICT, date date NOT NULL, ledger_id uuid NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
  reference text NOT NULL DEFAULT '', amount bigint NOT NULL DEFAULT 0 CHECK (amount BETWEEN 1 AND 9007199254740991),
  reversed_on date, reversal_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX associate_payouts_associate_idx ON associate_payouts(firm_id, associate_id, date);
CREATE TABLE commission_payout_allocations (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  payout_id uuid NOT NULL REFERENCES associate_payouts(id) ON DELETE RESTRICT, accrual_id uuid NOT NULL REFERENCES commission_accruals(id) ON DELETE RESTRICT,
  amount bigint NOT NULL DEFAULT 0 CHECK (amount BETWEEN 1 AND 9007199254740991)
);
CREATE UNIQUE INDEX commission_payout_allocations_entry_idx ON commission_payout_allocations(firm_id, payout_id, accrual_id);
CREATE TABLE associate_journals (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  journal_id uuid NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT, source_voucher_id uuid REFERENCES vouchers(id) ON DELETE RESTRICT,
  payout_id uuid REFERENCES associate_payouts(id) ON DELETE RESTRICT, purpose text NOT NULL
);
CREATE UNIQUE INDEX associate_journals_journal_idx ON associate_journals(firm_id, journal_id);
CREATE TABLE commission_entries (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid NOT NULL REFERENCES associates(id) ON DELETE RESTRICT, accrual_id uuid REFERENCES commission_accruals(id) ON DELETE RESTRICT,
  source_voucher_id uuid REFERENCES vouchers(id) ON DELETE RESTRICT, payout_id uuid REFERENCES associate_payouts(id) ON DELETE RESTRICT,
  journal_id uuid REFERENCES vouchers(id) ON DELETE RESTRICT, event_key text NOT NULL, date date NOT NULL, book_scope book_scope NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earned','adjustment','payout','payout-reversal')),
  amount bigint NOT NULL DEFAULT 0 CHECK (amount BETWEEN -9007199254740991 AND 9007199254740991), description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commission_entries_event_idx ON commission_entries(firm_id, event_key);
CREATE INDEX commission_entries_associate_idx ON commission_entries(firm_id, associate_id, date);
CREATE INDEX commission_entries_accrual_idx ON commission_entries(firm_id, accrual_id);
CREATE TABLE associate_events (
  id uuid PRIMARY KEY, firm_id uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  associate_id uuid REFERENCES associates(id) ON DELETE RESTRICT, action text NOT NULL, reason text NOT NULL,
  user_id uuid NOT NULL, user_name text NOT NULL, before jsonb NOT NULL, after jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX associate_events_associate_idx ON associate_events(firm_id, associate_id, id);

CREATE FUNCTION protect_associate_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Associate history is append-only'; END;
$$;
CREATE TRIGGER associate_events_immutable BEFORE UPDATE OR DELETE ON associate_events FOR EACH ROW EXECUTE FUNCTION protect_associate_history();
CREATE TRIGGER associate_rules_immutable BEFORE UPDATE OR DELETE ON associate_rules FOR EACH ROW EXECUTE FUNCTION protect_associate_history();
CREATE TRIGGER commission_entries_immutable BEFORE UPDATE OR DELETE ON commission_entries FOR EACH ROW EXECUTE FUNCTION protect_associate_history();
CREATE TRIGGER commission_allocations_immutable BEFORE UPDATE OR DELETE ON commission_payout_allocations FOR EACH ROW EXECUTE FUNCTION protect_associate_history();
CREATE TRIGGER associate_journals_immutable BEFORE UPDATE OR DELETE ON associate_journals FOR EACH ROW EXECUTE FUNCTION protect_associate_history();

CREATE FUNCTION protect_commission_accrual_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Commission accrual history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
    RAISE EXCEPTION 'Commission accrual snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER commission_accrual_snapshot_immutable BEFORE UPDATE OR DELETE ON commission_accruals FOR EACH ROW EXECUTE FUNCTION protect_commission_accrual_snapshot();

CREATE FUNCTION protect_delivery_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Delivery history cannot be deleted'; END IF;
  IF ROW(NEW.id, NEW.firm_id, NEW.associate_id, NEW.voucher_id, NEW.voucher_number, NEW.date, NEW.snapshot, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.firm_id, OLD.associate_id, OLD.voucher_id, OLD.voucher_number, OLD.date, OLD.snapshot, OLD.created_at) THEN
    RAISE EXCEPTION 'Delivery snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER delivery_snapshot_immutable BEFORE UPDATE OR DELETE ON delivery_assignments FOR EACH ROW EXECUTE FUNCTION protect_delivery_snapshot();

CREATE TABLE loans (
  id uuid PRIMARY KEY NOT NULL,
  firm_id uuid NOT NULL CONSTRAINT loans_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL CONSTRAINT loans_account_id_accounts_id_fk REFERENCES accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL,
  name text NOT NULL,
  counterparty text NOT NULL,
  agreement_reference text NOT NULL,
  note text NOT NULL,
  terms jsonb NOT NULL,
  maturity_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT loans_direction_check CHECK (direction IN ('borrowed', 'lent')),
  CONSTRAINT loans_status_check CHECK (status IN ('active', 'closed')),
  CONSTRAINT loans_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX loans_firm_account_idx ON loans(firm_id, account_id);
CREATE UNIQUE INDEX loans_firm_name_idx ON loans(firm_id, lower(name));
CREATE INDEX loans_firm_id_idx ON loans(firm_id, id);
--> statement-breakpoint
CREATE TABLE loan_repayment_references (
  id uuid PRIMARY KEY NOT NULL,
  firm_id uuid NOT NULL CONSTRAINT loan_repayment_references_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  loan_id uuid NOT NULL CONSTRAINT loan_repayment_references_loan_id_loans_id_fk REFERENCES loans(id) ON DELETE RESTRICT,
  voucher_id uuid NOT NULL CONSTRAINT loan_repayment_references_voucher_id_vouchers_id_fk REFERENCES vouchers(id) ON DELETE RESTRICT,
  voucher_version integer NOT NULL,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL,
  installment_number integer NOT NULL,
  principal_confirmed boolean NOT NULL,
  principal bigint NOT NULL DEFAULT 0,
  interest bigint NOT NULL DEFAULT 0,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT loan_references_amounts_check CHECK (principal > 0 AND interest >= 0 AND principal <= 9007199254740991 AND interest <= 9007199254740991),
  CONSTRAINT loan_references_installment_check CHECK (installment_number BETWEEN 1 AND 600 AND voucher_version > 0),
  CONSTRAINT loan_references_principal_confirmed_check CHECK (principal_confirmed)
);
--> statement-breakpoint
CREATE UNIQUE INDEX loan_references_voucher_idx ON loan_repayment_references(firm_id, voucher_id) WHERE removed_at IS NULL;
CREATE INDEX loan_references_loan_idx ON loan_repayment_references(firm_id, loan_id);
--> statement-breakpoint
CREATE TABLE loan_events (
  id uuid PRIMARY KEY NOT NULL,
  firm_id uuid NOT NULL CONSTRAINT loan_events_firm_id_organization_id_fk REFERENCES organization(id) ON DELETE RESTRICT,
  loan_id uuid NOT NULL CONSTRAINT loan_events_loan_id_loans_id_fk REFERENCES loans(id) ON DELETE RESTRICT,
  action text NOT NULL,
  reason text NOT NULL,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  before jsonb NOT NULL,
  after jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX loan_events_loan_idx ON loan_events(firm_id, loan_id, id);
CREATE TRIGGER loan_events_no_change BEFORE UPDATE OR DELETE ON loan_events
FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER loan_events_no_truncate BEFORE TRUNCATE ON loan_events
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint
-- Enforce tenant ownership even for accidental direct writes or a faulty restore mapper.
CREATE FUNCTION check_loan_ownership() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'loans' THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.firm_id = NEW.firm_id
      AND ((NEW.direction = 'borrowed' AND a.group_name IN ('Secured Loans', 'Unsecured Loans'))
        OR (NEW.direction = 'lent' AND a.group_name = 'Loans & Advances (Asset)'))
    ) THEN RAISE EXCEPTION 'Loan account has the wrong firm or group' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM loans l WHERE l.id = NEW.loan_id AND l.firm_id = NEW.firm_id)
    THEN RAISE EXCEPTION 'Loan belongs to another firm' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'loan_repayment_references' THEN
      IF NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.id = NEW.voucher_id AND v.firm_id = NEW.firm_id)
      THEN RAISE EXCEPTION 'Repayment journal belongs to another firm' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER loans_check_ownership BEFORE INSERT OR UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION check_loan_ownership();
CREATE TRIGGER loan_references_check_ownership BEFORE INSERT OR UPDATE ON loan_repayment_references
FOR EACH ROW EXECUTE FUNCTION check_loan_ownership();
CREATE TRIGGER loan_events_check_ownership BEFORE INSERT ON loan_events
FOR EACH ROW EXECUTE FUNCTION check_loan_ownership();

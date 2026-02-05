CREATE TABLE "book_control_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_controls" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"closed_through" date,
	"opening_approved_at" timestamp with time zone,
	"opening_approved_by" text,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_control_events" ADD CONSTRAINT "book_control_events_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_controls" ADD CONSTRAINT "book_controls_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_control_events_firm_idx" ON "book_control_events" USING btree ("firm_id","id");
--> statement-breakpoint
CREATE TRIGGER book_control_events_no_change BEFORE UPDATE OR DELETE ON book_control_events
FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint
CREATE TRIGGER book_control_events_no_truncate BEFORE TRUNCATE ON book_control_events
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
--> statement-breakpoint
-- Every opening-master write shares the approval lock, including offline replay.
CREATE FUNCTION protect_approved_openings() RETURNS trigger AS $$
DECLARE
  firm uuid;
  previous jsonb := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  following jsonb := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  fields text[];
  field text;
  old_amount numeric;
  new_amount numeric;
  changed boolean := false;
BEGIN
  firm := coalesce((following->>'firm_id')::uuid, (previous->>'firm_id')::uuid);
  PERFORM pg_advisory_xact_lock(hashtextextended(firm::text, 0));
  IF TG_TABLE_NAME = 'items' THEN
    fields := ARRAY['opening_stock', 'opening_cost', 'opening_book_scope', 'deleted_at'];
    old_amount := coalesce((previous->>'opening_stock')::numeric, 0);
    new_amount := coalesce((following->>'opening_stock')::numeric, 0);
  ELSIF TG_TABLE_NAME = 'opening_accounts' THEN
    fields := ARRAY['account', 'amount'];
    old_amount := coalesce((previous->>'amount')::numeric, 0);
    new_amount := coalesce((following->>'amount')::numeric, 0);
  ELSE
    fields := ARRAY['opening_balance', 'opening_date', 'type', 'kind', 'group_name', 'deleted_at'];
    old_amount := coalesce((previous->>'opening_balance')::numeric, 0);
    new_amount := coalesce((following->>'opening_balance')::numeric, 0);
  END IF;
  FOREACH field IN ARRAY fields LOOP
    changed := changed OR (previous->field IS DISTINCT FROM following->field);
  END LOOP;
  IF changed AND (old_amount <> 0 OR new_amount <> 0) AND EXISTS (
    SELECT 1 FROM book_controls WHERE firm_id = firm AND
      (opening_approved_at IS NOT NULL OR closed_through IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0010', MESSAGE = 'Opening balances are approved. Ask the owner to reopen opening balances before changing them.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER parties_protect_openings BEFORE INSERT OR UPDATE OR DELETE ON parties
FOR EACH ROW EXECUTE FUNCTION protect_approved_openings();
--> statement-breakpoint
CREATE TRIGGER items_protect_openings BEFORE INSERT OR UPDATE OR DELETE ON items
FOR EACH ROW EXECUTE FUNCTION protect_approved_openings();
--> statement-breakpoint
CREATE TRIGGER ledgers_protect_openings BEFORE INSERT OR UPDATE OR DELETE ON ledgers
FOR EACH ROW EXECUTE FUNCTION protect_approved_openings();
--> statement-breakpoint
CREATE TRIGGER accounts_protect_openings BEFORE INSERT OR UPDATE OR DELETE ON accounts
FOR EACH ROW EXECUTE FUNCTION protect_approved_openings();
--> statement-breakpoint
CREATE TRIGGER opening_accounts_protect_openings BEFORE INSERT OR UPDATE OR DELETE ON opening_accounts
FOR EACH ROW EXECUTE FUNCTION protect_approved_openings();

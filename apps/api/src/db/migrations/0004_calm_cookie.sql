CREATE TYPE "sync_entity" AS ENUM ('party', 'item', 'ledger', 'voucher', 'document', 'firm-profile', 'invoice-settings', 'reminder-settings');--> statement-breakpoint
CREATE TYPE "sync_action" AS ENUM ('upsert', 'deleted');--> statement-breakpoint
CREATE TABLE "change_log" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "change_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firm_id" uuid NOT NULL,
	"entity" "sync_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "sync_action" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_firm_seq_idx" ON "change_log" USING btree ("firm_id","seq");--> statement-breakpoint
CREATE INDEX "change_log_firm_entity_idx" ON "change_log" USING btree ("firm_id","entity","entity_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_sync_change()
RETURNS trigger AS $$
DECLARE
	new_data jsonb;
	old_data jsonb;
	next_action sync_action := 'upsert';
	next_firm_id uuid;
	next_entity_id uuid;
BEGIN
	new_data := to_jsonb(NEW);
	old_data := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;

	IF new_data ? 'deleted_at'
		AND new_data->>'deleted_at' IS NOT NULL
		AND old_data->>'deleted_at' IS NULL THEN
		next_action := 'deleted';
	END IF;

	next_firm_id := COALESCE(new_data->>'firm_id', new_data->>'id')::uuid;
	next_entity_id := COALESCE(new_data->>'id', new_data->>'firm_id')::uuid;

	INSERT INTO change_log (firm_id, entity, entity_id, action)
	VALUES (next_firm_id, TG_ARGV[0]::sync_entity, next_entity_id, next_action);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER parties_sync_change AFTER INSERT OR UPDATE ON "parties" FOR EACH ROW EXECUTE FUNCTION record_sync_change('party');--> statement-breakpoint
CREATE TRIGGER items_sync_change AFTER INSERT OR UPDATE ON "items" FOR EACH ROW EXECUTE FUNCTION record_sync_change('item');--> statement-breakpoint
CREATE TRIGGER ledgers_sync_change AFTER INSERT OR UPDATE ON "ledgers" FOR EACH ROW EXECUTE FUNCTION record_sync_change('ledger');--> statement-breakpoint
CREATE TRIGGER vouchers_sync_change AFTER INSERT OR UPDATE ON "vouchers" FOR EACH ROW EXECUTE FUNCTION record_sync_change('voucher');--> statement-breakpoint
CREATE TRIGGER documents_sync_change AFTER INSERT OR UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION record_sync_change('document');--> statement-breakpoint
CREATE TRIGGER firm_profile_sync_change AFTER INSERT OR UPDATE ON "firm_profile" FOR EACH ROW EXECUTE FUNCTION record_sync_change('firm-profile');--> statement-breakpoint
CREATE TRIGGER invoice_settings_sync_change AFTER INSERT OR UPDATE ON "invoice_settings" FOR EACH ROW EXECUTE FUNCTION record_sync_change('invoice-settings');--> statement-breakpoint
CREATE TRIGGER reminder_settings_sync_change AFTER INSERT OR UPDATE ON "reminder_settings" FOR EACH ROW EXECUTE FUNCTION record_sync_change('reminder-settings');--> statement-breakpoint
CREATE TRIGGER organization_sync_change AFTER UPDATE OF "name" ON "organization" FOR EACH ROW EXECUTE FUNCTION record_sync_change('firm-profile');--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'party'::sync_entity, "id", CASE WHEN "deleted_at" IS NULL THEN 'upsert'::sync_action ELSE 'deleted'::sync_action END, "updated_at" FROM "parties";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'item'::sync_entity, "id", CASE WHEN "deleted_at" IS NULL THEN 'upsert'::sync_action ELSE 'deleted'::sync_action END, "updated_at" FROM "items";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'ledger'::sync_entity, "id", CASE WHEN "deleted_at" IS NULL THEN 'upsert'::sync_action ELSE 'deleted'::sync_action END, "updated_at" FROM "ledgers";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'voucher'::sync_entity, "id", 'upsert'::sync_action, "updated_at" FROM "vouchers";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'document'::sync_entity, "id", CASE WHEN "deleted_at" IS NULL THEN 'upsert'::sync_action ELSE 'deleted'::sync_action END, "updated_at" FROM "documents";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'firm-profile'::sync_entity, "firm_id", 'upsert'::sync_action, "updated_at" FROM "firm_profile";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'invoice-settings'::sync_entity, "firm_id", 'upsert'::sync_action, "updated_at" FROM "invoice_settings";--> statement-breakpoint
INSERT INTO "change_log" ("firm_id", "entity", "entity_id", "action", "changed_at")
SELECT "firm_id", 'reminder-settings'::sync_entity, "firm_id", 'upsert'::sync_action, "updated_at" FROM "reminder_settings";

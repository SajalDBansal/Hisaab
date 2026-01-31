ALTER TYPE "public"."sync_entity" ADD VALUE 'account' BEFORE 'party';--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group_name" text NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_firm_name_idx" ON "accounts" USING btree ("firm_id",lower("name"));
--> statement-breakpoint
CREATE TRIGGER accounts_sync AFTER INSERT OR UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION record_sync_change('account');

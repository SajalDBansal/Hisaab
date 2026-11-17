-- Custom fields on parties, items and voucher headers (doc 37, T07).
-- Definitions live in custom_fields; values are jsonb on the rows, keyed by the
-- field's permanent key. Existing rows get null (no values).
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"key" text NOT NULL,
	"entity" text NOT NULL,
	"definition" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "custom_fields" jsonb;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_firm_key_idx" ON "custom_fields" USING btree ("firm_id","key");--> statement-breakpoint
CREATE INDEX "custom_fields_firm_entity_idx" ON "custom_fields" USING btree ("firm_id","entity","position");
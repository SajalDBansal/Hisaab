-- Firm logo and signature for documents (doc 37, T16). A separate table so the
-- images are not copied into every voucher's frozen invoice-settings snapshot.
CREATE TABLE "firm_branding" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"logo" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "firm_branding" ADD CONSTRAINT "firm_branding_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
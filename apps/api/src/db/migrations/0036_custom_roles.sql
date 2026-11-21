-- Custom roles (doc 37, T57). A member's role holds "r_<id>" for these; the
-- four built-in roles stay fixed in code, so existing members are unchanged.
CREATE TABLE "custom_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rights" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_roles_firm_idx" ON "custom_roles" USING btree ("firm_id");
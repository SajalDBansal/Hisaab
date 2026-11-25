-- Salespersons (doc 37, T10): the firm's salespersons, optionally linked to a login, and the salesperson on sales and customer-side orders.
CREATE TABLE "salespersons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"phone" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "salesperson_id" uuid;--> statement-breakpoint
ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salespersons_firm_idx" ON "salespersons" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salespersons_firm_name_idx" ON "salespersons" USING btree ("firm_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "salespersons_firm_user_idx" ON "salespersons" USING btree ("firm_id","user_id") WHERE "salespersons"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE restrict ON UPDATE no action;
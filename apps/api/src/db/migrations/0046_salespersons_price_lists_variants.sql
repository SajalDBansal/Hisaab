-- Salespersons (doc 37, T10), price lists (T36) and item variants (T35): salespersons table and vouchers.salesperson_id; price_lists table (one default per side) and parties.price_list_id; items.variant_attributes, parent_id and variant_values.
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"side" text NOT NULL,
	"mode" text NOT NULL,
	"percent" numeric(7, 3),
	"rates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_lists_side_check" CHECK ("price_lists"."side" in ('sale','purchase')),
	CONSTRAINT "price_lists_mode_check" CHECK ("price_lists"."mode" in ('percent','rates'))
);
--> statement-breakpoint
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
ALTER TABLE "items" ADD COLUMN "variant_attributes" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "variant_values" jsonb;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "salesperson_id" uuid;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salespersons" ADD CONSTRAINT "salespersons_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_firm_name_idx" ON "price_lists" USING btree ("firm_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_firm_default_idx" ON "price_lists" USING btree ("firm_id","side") WHERE "price_lists"."is_default";--> statement-breakpoint
CREATE INDEX "salespersons_firm_idx" ON "salespersons" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salespersons_firm_name_idx" ON "salespersons" USING btree ("firm_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "salespersons_firm_user_idx" ON "salespersons" USING btree ("firm_id","user_id") WHERE "salespersons"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_salesperson_id_salespersons_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespersons"("id") ON DELETE restrict ON UPDATE no action;
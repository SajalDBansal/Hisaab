-- Price lists (doc 37, T36): sale and purchase lists (percentage on the item price, or per-item rates), one default per side, and the party's list.
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
ALTER TABLE "parties" ADD COLUMN "price_list_id" uuid;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_firm_name_idx" ON "price_lists" USING btree ("firm_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_firm_default_idx" ON "price_lists" USING btree ("firm_id","side") WHERE "price_lists"."is_default";--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE restrict ON UPDATE no action;
-- Credit control for sales (doc 37, T11): what overdue bills do to a new sale.
CREATE TYPE "public"."overdue_sales_policy" AS ENUM('off', 'warn', 'block');--> statement-breakpoint
CREATE TABLE "sales_controls" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"overdue_sales" "overdue_sales_policy" DEFAULT 'warn' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_controls" ADD CONSTRAINT "sales_controls_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;
-- Stock levels, expiry and item master extras (doc 37, T37/T38/T39): stock policy on sales_controls, item kind/not-for-sale/tags/max stock, batch and expiry on voucher lines.
CREATE TYPE "public"."stock_policy" AS ENUM('warn', 'block');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('goods', 'service');--> statement-breakpoint
ALTER TABLE "sales_controls" ADD COLUMN "stock_policy" "stock_policy" DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "kind" "item_kind" DEFAULT 'goods' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "not_for_sale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "max_stock" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "batch_number" text;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "expiry_date" date;
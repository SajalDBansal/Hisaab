CREATE TYPE "public"."book_scope" AS ENUM('gst', 'nongst');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "opening_cost" bigint;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "opening_book_scope" "book_scope";--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "stock_lot_id" text;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "stock_cost" bigint;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "book_scope" "book_scope";--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "book_scope" "book_scope";--> statement-breakpoint
-- Freeze the best available opening valuation without changing issued vouchers.
UPDATE items SET opening_cost = purchase_price,
  opening_book_scope = CASE WHEN tax_type = 'nongst' OR firm_id IN
    (SELECT firm_id FROM firm_profile WHERE gst_registration = 'unregistered')
    THEN 'nongst'::book_scope ELSE 'gst'::book_scope END;

-- Discounts and charges (doc 37, T09): charge heads in invoice settings, frozen charge-head details on voucher charges, subtotal discount on vouchers and each line's share.
ALTER TABLE "invoice_settings" ADD COLUMN "charge_heads" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD COLUMN "head_id" text;--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD COLUMN "tax_type" "tax_type";--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD COLUMN "sac" text;--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD COLUMN "account" text;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD COLUMN "bill_discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "bill_discount_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "bill_discount_amount" bigint DEFAULT 0 NOT NULL;
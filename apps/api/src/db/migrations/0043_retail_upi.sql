-- Retail bills (doc 37, T02): own number series and thermal roll on invoice settings, buyer details on retail sales; UPI QR on bills (T18).
ALTER TABLE "invoice_settings" ADD COLUMN "retail_prefix" text DEFAULT 'RI' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD COLUMN "retail_paper" text DEFAULT '80' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD COLUMN "upi_qr" jsonb;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "retail" jsonb;
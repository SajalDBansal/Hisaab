-- Delivery challans (doc 37, T04): firm setting for whether new challans move stock (default yes), and each challan's purpose and whether it moved stock when issued (null = it did, as before).
ALTER TABLE "sales_controls" ADD COLUMN "challan_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "challan_type" text;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "challan_stock" boolean;
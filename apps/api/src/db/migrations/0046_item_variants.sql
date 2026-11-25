-- Item variants (doc 37, T35): a parent item's attributes, and each variant's parent and attribute values.
ALTER TABLE "items" ADD COLUMN "variant_attributes" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "variant_values" jsonb;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;
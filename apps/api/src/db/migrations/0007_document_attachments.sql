ALTER TABLE "documents" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "account_key" text;
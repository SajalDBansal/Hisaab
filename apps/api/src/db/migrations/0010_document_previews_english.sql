DROP TABLE "user_preferences" CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
DROP TYPE "public"."language";
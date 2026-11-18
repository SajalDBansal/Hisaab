-- Business profile and MSME (doc 37, T61/T30): optional firm statutory fields, MSME class and Udyam number on parties.
CREATE TYPE "public"."business_type" AS ENUM('retail', 'wholesale', 'distribution', 'manufacturing', 'services', 'other');--> statement-breakpoint
CREATE TYPE "public"."msme_type" AS ENUM('micro', 'small', 'medium');--> statement-breakpoint
CREATE TYPE "public"."ownership_type" AS ENUM('proprietorship', 'partnership', 'llp', 'private-limited', 'public-limited', 'one-person-company', 'huf', 'trust-society', 'other');--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "ownership_type" "ownership_type";--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "business_type" "business_type";--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "tan" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "udyam_number" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "msme_type" "msme_type";--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "iec" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "fssai" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "drug_licence" text;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "msme_type" "msme_type";--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "udyam_number" text;
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "vouchers_firm_date_idx";--> statement-breakpoint
DROP INDEX "vouchers_firm_party_idx";--> statement-breakpoint
DROP INDEX "vouchers_firm_type_date_idx";--> statement-breakpoint
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "parties_name_trgm_idx" ON "parties" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vouchers_firm_date_id_idx" ON "vouchers" USING btree ("firm_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vouchers_firm_party_date_idx" ON "vouchers" USING btree ("firm_id","party_id","date");--> statement-breakpoint
CREATE INDEX "vouchers_firm_type_date_idx" ON "vouchers" USING btree ("firm_id","type","date" DESC NULLS LAST);

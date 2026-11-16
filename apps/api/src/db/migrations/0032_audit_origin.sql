-- Edit log: the IP address and device of each change (doc 37, T55).
-- Older rows stay null. Adding columns does not touch the append-only trigger,
-- which only rejects UPDATE and DELETE of rows.
ALTER TABLE "audit_log" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "device" text;

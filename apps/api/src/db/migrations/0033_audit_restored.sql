-- Edit log: a cancelled voucher put back by the owner (doc 37, T47).
-- PostgreSQL 12+ allows ADD VALUE inside the migration transaction; nothing in
-- this migration uses the new value.
ALTER TYPE "public"."audit_action" ADD VALUE 'restored' BEFORE 'bank-date';

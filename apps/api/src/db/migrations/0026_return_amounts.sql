-- Historical notes retain their issued calculations; only new returns save these components.
ALTER TABLE voucher_lines ADD COLUMN IF NOT EXISTS return_amounts jsonb;

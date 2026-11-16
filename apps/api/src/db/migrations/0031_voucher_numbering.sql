-- Voucher numbering rules per type (doc 37, Phase 0): { start, digits, showYear }.
-- Existing firms get {} and keep the default format, so no number changes.
ALTER TABLE "invoice_settings" ADD COLUMN "numbering" jsonb DEFAULT '{}'::jsonb NOT NULL;

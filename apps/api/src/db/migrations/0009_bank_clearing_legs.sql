ALTER TABLE "vouchers" ADD COLUMN "bank_clearings" jsonb;
--> statement-breakpoint
-- Preserve the old date on one bank leg; transfers never imply both banks cleared together.
UPDATE vouchers v
SET bank_clearings = jsonb_build_object(
  COALESCE(
    (SELECT l.id::text FROM ledgers l WHERE l.id = v.ledger_id AND l.firm_id = v.firm_id AND l.kind = 'bank'),
    (SELECT l.id::text FROM ledgers l WHERE l.id = v.to_ledger_id AND l.firm_id = v.firm_id AND l.kind = 'bank')
  ), v.cleared_on::text
)
WHERE v.cleared_on IS NOT NULL
  AND EXISTS (SELECT 1 FROM ledgers l WHERE l.firm_id = v.firm_id AND l.kind = 'bank' AND l.id IN (v.ledger_id, v.to_ledger_id));

CREATE TABLE "operation_receipts" (
  "user_id" uuid NOT NULL REFERENCES "public"."user"("id") ON DELETE RESTRICT,
  "key" text NOT NULL,
  "firm_id" uuid REFERENCES "public"."organization"("id") ON DELETE RESTRICT,
  "role" text,
  "request_hash" text NOT NULL,
  "legacy" integer DEFAULT 0 NOT NULL CHECK ("legacy" IN (0, 1)),
  "result" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "key")
);
--> statement-breakpoint
CREATE INDEX "operation_receipts_firm_idx" ON "operation_receipts" ("firm_id", "user_id");
--> statement-breakpoint
-- Archive identifiable financial/account and document reservation answers, not arbitrary cached API responses.
CREATE FUNCTION "retain_book_operation_answer"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.response->>'type' IN ('sale','purchase','receipt','payment','expense','journal','contra','credit-note','debit-note','estimate','sales-order','purchase-order','delivery-note'))
    OR (jsonb_typeof(NEW.response) = 'array' AND NEW.response->0->>'type' = 'sale')
    OR (NEW.response ? 'id' AND NEW.response->>'kind' IN ('cash','bank'))
    OR (NEW.response ? 'id' AND NEW.response ? 'group' AND NEW.response ? 'openingBalance')
    OR (NEW.response->'document' ? 'id' AND NEW.response ? 'uploadUrl' AND NEW.response ? 'expiresAt') THEN
    INSERT INTO operation_receipts (user_id, key, request_hash, legacy, result, created_at)
    VALUES (NEW.user_id, NEW.key, NEW.request_hash, 1,
      jsonb_build_object('state','committed','response',NEW.response), NEW.created_at)
    ON CONFLICT (user_id, key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "retain_book_operation_answer" AFTER INSERT ON "idempotency_keys"
FOR EACH ROW EXECUTE FUNCTION "retain_book_operation_answer"();
--> statement-breakpoint
INSERT INTO operation_receipts (user_id, key, request_hash, legacy, result, created_at)
SELECT user_id, key, request_hash, 1, jsonb_build_object('state','committed','response',response), created_at
FROM idempotency_keys
WHERE response->>'type' IN ('sale','purchase','receipt','payment','expense','journal','contra','credit-note','debit-note','estimate','sales-order','purchase-order','delivery-note')
   OR (jsonb_typeof(response) = 'array' AND response->0->>'type' = 'sale')
   OR (response ? 'id' AND response->>'kind' IN ('cash','bank'))
   OR (response ? 'id' AND response ? 'group' AND response ? 'openingBalance')
   OR (response->'document' ? 'id' AND response ? 'uploadUrl' AND response ? 'expiresAt')
ON CONFLICT (user_id, key) DO NOTHING;

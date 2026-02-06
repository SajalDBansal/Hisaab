CREATE TABLE "order_source_lines" (
  "id" uuid PRIMARY KEY NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE restrict,
  "source_id" uuid NOT NULL REFERENCES "vouchers"("id") ON DELETE restrict,
  "position" integer NOT NULL,
  "line" jsonb NOT NULL,
  CONSTRAINT "order_source_lines_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_source_lines_position_idx" ON "order_source_lines" ("firm_id", "source_id", "position");
CREATE INDEX "order_source_lines_source_idx" ON "order_source_lines" ("firm_id", "source_id");
--> statement-breakpoint
CREATE TABLE "order_fulfillments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE restrict,
  "source_id" uuid NOT NULL REFERENCES "vouchers"("id") ON DELETE restrict,
  "user_id" uuid NOT NULL,
  "user_name" text NOT NULL,
  "key" text NOT NULL,
  "request_hash" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_fulfillments_retry_idx" ON "order_fulfillments" ("firm_id", "user_id", "key");
CREATE INDEX "order_fulfillments_source_idx" ON "order_fulfillments" ("firm_id", "source_id");
--> statement-breakpoint
CREATE TABLE "order_fulfillment_lines" (
  "id" uuid PRIMARY KEY NOT NULL,
  "firm_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE restrict,
  "fulfillment_id" uuid NOT NULL REFERENCES "order_fulfillments"("id") ON DELETE restrict,
  "source_line_id" uuid NOT NULL REFERENCES "order_source_lines"("id") ON DELETE restrict,
  "target_id" uuid NOT NULL REFERENCES "vouchers"("id") ON DELETE restrict,
  "target_position" integer NOT NULL,
  "qty" numeric(14,3) NOT NULL,
  "stock_fulfilled_by_id" uuid REFERENCES "vouchers"("id") ON DELETE restrict,
  CONSTRAINT "order_fulfillment_lines_qty_check" CHECK ("qty" > 0),
  CONSTRAINT "order_fulfillment_lines_position_check" CHECK ("target_position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_fulfillment_lines_target_idx" ON "order_fulfillment_lines" ("firm_id", "target_id", "target_position");
CREATE INDEX "order_fulfillment_lines_source_idx" ON "order_fulfillment_lines" ("firm_id", "source_line_id");
CREATE INDEX "order_fulfillment_lines_receipt_idx" ON "order_fulfillment_lines" ("fulfillment_id");

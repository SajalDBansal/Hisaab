CREATE TABLE "recovery_identity_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "archive_digest" text NOT NULL,
  "evidence" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "recovery_identity_tickets_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "recovery_identity_tickets_user_id_user_id_fk" FOREIGN KEY("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT,
  CONSTRAINT "recovery_identity_hash_check" CHECK ("token_hash" ~ '^[a-f0-9]{64}$' AND "archive_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recovery_identity_expiry_check" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '1 hour')
);
--> statement-breakpoint
CREATE INDEX "recovery_identity_user_idx" ON "recovery_identity_tickets" ("user_id");

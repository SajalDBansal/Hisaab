CREATE TYPE "public"."composition_type" AS ENUM('trader', 'restaurant', 'services');--> statement-breakpoint
CREATE TYPE "public"."gst_registration" AS ENUM('regular', 'composition', 'unregistered');--> statement-breakpoint
CREATE TYPE "public"."invoice_template" AS ENUM('classic', 'modern', 'compact');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('customer', 'supplier');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('taxable', 'nil', 'exempt', 'nongst');--> statement-breakpoint
CREATE TYPE "public"."gst_mode" AS ENUM('regular', 'composition', 'off');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'upi', 'bank', 'cheque', 'card');--> statement-breakpoint
CREATE TYPE "public"."sale_doc_type" AS ENUM('tax-invoice', 'bill-of-supply', 'invoice');--> statement-breakpoint
CREATE TYPE "public"."voucher_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."voucher_type" AS ENUM('sale', 'purchase', 'receipt', 'payment', 'expense', 'journal', 'credit-note', 'debit-note', 'contra', 'estimate', 'sales-order', 'delivery-note', 'purchase-order');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('created', 'edited', 'cancelled', 'converted', 'reopened', 'bank-date');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('bill', 'receipt', 'certificate', 'agreement', 'other');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"platform" text DEFAULT 'app' NOT NULL,
	"device_name" text,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firm_profile" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text NOT NULL,
	"state_code" text NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"gst_registration" "gst_registration" NOT NULL,
	"composition_type" "composition_type",
	"fy_start" date NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"pan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"template" "invoice_template" DEFAULT 'classic' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"show_bank_details" boolean DEFAULT false NOT NULL,
	"bank_ledger_id" uuid,
	"bank_account" jsonb,
	"prefixes" jsonb NOT NULL,
	"bill_of_supply_prefix" text DEFAULT 'BS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_settings" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"days_before" integer DEFAULT 3 NOT NULL,
	"on_due_date" boolean DEFAULT true NOT NULL,
	"repeat_every" integer DEFAULT 7 NOT NULL,
	"min_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"language" "language" DEFAULT 'en' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"hsn" text DEFAULT '' NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"tax_type" "tax_type" DEFAULT 'taxable' NOT NULL,
	"gst_rate" integer DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"alt_unit_name" text,
	"alt_unit_factor" numeric(14, 3),
	"purchase_price" bigint DEFAULT 0 NOT NULL,
	"sale_price" bigint DEFAULT 0 NOT NULL,
	"mrp" bigint DEFAULT 0 NOT NULL,
	"reorder_level" numeric(14, 3) DEFAULT 0 NOT NULL,
	"opening_stock" numeric(14, 3) DEFAULT 0 NOT NULL,
	"batch_number" text,
	"batch_expiry" date,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "items_gst_rate_check" CHECK ("items"."gst_rate" in (0, 5, 18, 40)),
	CONSTRAINT "items_prices_check" CHECK ("items"."purchase_price" >= 0 and "items"."sale_price" >= 0 and "items"."mrp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"short_name" text NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_accounts" (
	"firm_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "opening_accounts_firm_id_account_pk" PRIMARY KEY("firm_id","account")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "party_type" NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state_code" text NOT NULL,
	"gstin" text,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"credit_limit" bigint DEFAULT 0 NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "parties_credit_check" CHECK ("parties"."credit_days" >= 0 and "parties"."credit_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "units" (
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"uqc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "units_firm_id_name_pk" PRIMARY KEY("firm_id","name")
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"bill_id" uuid,
	"opening_party_id" uuid,
	"amount" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "allocations_amount_check" CHECK ("allocations"."amount" > 0),
	CONSTRAINT "allocations_target_check" CHECK (("allocations"."bill_id" is null) <> ("allocations"."opening_party_id" is null))
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"account" text NOT NULL,
	"name" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "journal_lines_side_check" CHECK ("journal_lines"."debit" >= 0 and "journal_lines"."credit" >= 0 and not ("journal_lines"."debit" > 0 and "journal_lines"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"account" text NOT NULL,
	"ledger_name" text NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "postings_side_check" CHECK ("postings"."debit" >= 0 and "postings"."credit" >= 0 and not ("postings"."debit" > 0 and "postings"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"date" date NOT NULL,
	"qty" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"gst_rate" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_counters" (
	"firm_id" uuid NOT NULL,
	"type" "voucher_type" NOT NULL,
	"series" text NOT NULL,
	"financial_year" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "voucher_counters_firm_id_type_series_financial_year_pk" PRIMARY KEY("firm_id","type","series","financial_year")
);
--> statement-breakpoint
CREATE TABLE "voucher_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"rate" bigint DEFAULT 0 NOT NULL,
	"per_unit" text,
	"per_factor" numeric(14, 3),
	"discount_percent" numeric(6, 3),
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"gst_rate" integer DEFAULT 0 NOT NULL,
	"tax_type" "tax_type",
	"source_line" smallint
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"type" "voucher_type" NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" "voucher_status" DEFAULT 'posted' NOT NULL,
	"party_id" uuid,
	"amount" bigint DEFAULT 0 NOT NULL,
	"narration" text,
	"inter_state" boolean,
	"due_date" date,
	"supplier_invoice_no" text,
	"doc_type" "sale_doc_type",
	"tax_mode" "gst_mode",
	"against_id" uuid,
	"note_reason" text,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"valid_until" date,
	"source_id" uuid,
	"converted_to_id" uuid,
	"mode" "payment_mode",
	"ledger_id" uuid,
	"to_ledger_id" uuid,
	"reference" text,
	"expense_head" text,
	"cleared_on" date,
	"tds_section" text,
	"tds_rate" numeric(6, 3),
	"tds_amount" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "vouchers_amount_check" CHECK ("vouchers"."amount" >= 0 and "vouchers"."tds_amount" >= 0),
	CONSTRAINT "vouchers_contra_check" CHECK ("vouchers"."type" <> 'contra' or "vouchers"."ledger_id" <> "vouchers"."to_ledger_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"number" text NOT NULL,
	"voucher_type" "voucher_type" NOT NULL,
	"action" "audit_action" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"s3_key" text,
	"party_id" uuid,
	"voucher_id" uuid,
	"note" text,
	"uploaded_on" date NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notice_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_firm_id_user_id_notice_key_pk" PRIMARY KEY("firm_id","user_id","notice_key")
);
--> statement-breakpoint
CREATE TABLE "reminders_sent" (
	"firm_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "reminders_sent_firm_id_party_id_pk" PRIMARY KEY("firm_id","party_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_profile" ADD CONSTRAINT "firm_profile_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ledgers_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_accounts" ADD CONSTRAINT "opening_accounts_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_bill_id_vouchers_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_opening_party_id_parties_id_fk" FOREIGN KEY ("opening_party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD CONSTRAINT "voucher_charges_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_charges" ADD CONSTRAINT "voucher_charges_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_counters" ADD CONSTRAINT "voucher_counters_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_against_id_vouchers_id_fk" FOREIGN KEY ("against_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_source_id_vouchers_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_converted_to_id_vouchers_id_fk" FOREIGN KEY ("converted_to_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_to_ledger_id_ledgers_id_fk" FOREIGN KEY ("to_ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_firm_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_firm_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "items_firm_name_idx" ON "items" USING btree ("firm_id",lower("name")) WHERE "items"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_firm_code_idx" ON "items" USING btree ("firm_id","code") WHERE "items"."code" <> '' and "items"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledgers_firm_name_idx" ON "ledgers" USING btree ("firm_id",lower("name")) WHERE "ledgers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "parties_firm_name_idx" ON "parties" USING btree ("firm_id",lower("name")) WHERE "parties"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "parties_firm_type_idx" ON "parties" USING btree ("firm_id","type");--> statement-breakpoint
CREATE INDEX "allocations_bill_idx" ON "allocations" USING btree ("firm_id","bill_id");--> statement-breakpoint
CREATE INDEX "allocations_voucher_idx" ON "allocations" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "allocations_opening_idx" ON "allocations" USING btree ("firm_id","opening_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_lines_position_idx" ON "journal_lines" USING btree ("voucher_id","position");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" USING btree ("firm_id","account","date");--> statement-breakpoint
CREATE INDEX "postings_voucher_idx" ON "postings" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("firm_id","item_id","date");--> statement-breakpoint
CREATE INDEX "stock_movements_voucher_idx" ON "stock_movements" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_charges_position_idx" ON "voucher_charges" USING btree ("voucher_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_lines_position_idx" ON "voucher_lines" USING btree ("voucher_id","position");--> statement-breakpoint
CREATE INDEX "voucher_lines_item_idx" ON "voucher_lines" USING btree ("firm_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_firm_type_number_idx" ON "vouchers" USING btree ("firm_id","type","number");--> statement-breakpoint
CREATE INDEX "vouchers_firm_date_idx" ON "vouchers" USING btree ("firm_id","date");--> statement-breakpoint
CREATE INDEX "vouchers_firm_party_idx" ON "vouchers" USING btree ("firm_id","party_id");--> statement-breakpoint
CREATE INDEX "vouchers_firm_type_date_idx" ON "vouchers" USING btree ("firm_id","type","date");--> statement-breakpoint
CREATE INDEX "audit_log_voucher_idx" ON "audit_log" USING btree ("firm_id","voucher_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_firm_at_idx" ON "audit_log" USING btree ("firm_id","at");--> statement-breakpoint
CREATE INDEX "documents_firm_idx" ON "documents" USING btree ("firm_id","uploaded_on");--> statement-breakpoint
CREATE INDEX "idempotency_created_idx" ON "idempotency_keys" USING btree ("created_at");
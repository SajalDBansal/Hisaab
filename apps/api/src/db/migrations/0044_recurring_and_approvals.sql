-- Recurring entries and approvals (doc 37, T03/T06): recurring_schedules (template + frequency + next date), pending_entries (recurring drafts and entries waiting for approval, one per schedule and date), approval_controls (entry types that need approval).
CREATE TYPE "public"."pending_entry_source" AS ENUM('recurring', 'approval');--> statement-breakpoint
CREATE TYPE "public"."pending_entry_status" AS ENUM('draft', 'submitted', 'rejected', 'posted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TABLE "approval_controls" (
	"firm_id" uuid PRIMARY KEY NOT NULL,
	"types" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"voucher_type" "voucher_type" NOT NULL,
	"status" "pending_entry_status" NOT NULL,
	"source" "pending_entry_source" NOT NULL,
	"schedule_id" uuid,
	"due_date" date,
	"date" date NOT NULL,
	"party_id" uuid,
	"amount" bigint DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_by_name" text NOT NULL,
	"submitted_by" uuid,
	"submitted_by_name" text,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"voucher_id" uuid,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"voucher_type" "voucher_type" NOT NULL,
	"template" jsonb NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"max_count" integer,
	"generated_count" integer DEFAULT 0 NOT NULL,
	"next_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"last_skipped_on" date,
	"source_voucher_id" uuid,
	"created_by" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_controls" ADD CONSTRAINT "approval_controls_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entries" ADD CONSTRAINT "pending_entries_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_entries" ADD CONSTRAINT "pending_entries_schedule_id_recurring_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."recurring_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_firm_id_organization_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_entries_firm_status_idx" ON "pending_entries" USING btree ("firm_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_entries_schedule_date_key" ON "pending_entries" USING btree ("schedule_id","due_date");--> statement-breakpoint
CREATE INDEX "recurring_schedules_firm_idx" ON "recurring_schedules" USING btree ("firm_id","id");--> statement-breakpoint
CREATE INDEX "recurring_schedules_due_idx" ON "recurring_schedules" USING btree ("next_date") WHERE "recurring_schedules"."active" and "recurring_schedules"."next_date" is not null;
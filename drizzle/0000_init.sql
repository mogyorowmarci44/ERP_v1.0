CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'expense', 'revenue', 'off_balance');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'accountant', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."vat_kind" AS ENUM('normal', 'margin', 'exempt', 'out_of_scope', 'reverse_charge', 'eu_acquisition', 'eu_supply', 'export');--> statement-breakpoint
CREATE TYPE "public"."vat_period" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('in_stock', 'reserved', 'sold');--> statement-breakpoint
CREATE TYPE "public"."vehicle_vat" AS ENUM('margin', 'normal');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "account_type" NOT NULL,
	"is_posting" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"report_line" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_number" varchar(20),
	"eu_vat_number" varchar(20),
	"registration_number" varchar(30),
	"address" text,
	"base_currency" varchar(3) DEFAULT 'HUF' NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"vat_period" "vat_period" DEFAULT 'monthly' NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) DEFAULT 1 NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"vat_code_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"vehicle_id" integer,
	"net_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"gross_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"margin_purchase_huf" numeric(18, 2)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"direction" "invoice_direction" NOT NULL,
	"partner_id" integer NOT NULL,
	"invoice_number" varchar(64) NOT NULL,
	"issue_date" date NOT NULL,
	"fulfillment_date" date NOT NULL,
	"due_date" date,
	"payment_method" varchar(20) DEFAULT 'transfer' NOT NULL,
	"currency" varchar(3) DEFAULT 'HUF' NOT NULL,
	"exchange_rate" numeric(18, 6) DEFAULT 1 NOT NULL,
	"net_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"vat_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"gross_huf" numeric(18, 2) DEFAULT 0 NOT NULL,
	"gross_fx" numeric(18, 2) DEFAULT 0 NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"journal_id" integer NOT NULL,
	"number" varchar(32) NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source_type" varchar(20),
	"source_id" integer,
	"reversal_of_id" integer,
	"reversed_by_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(18, 2) DEFAULT 0 NOT NULL,
	"description" text,
	"partner_id" integer,
	"vehicle_id" integer,
	"vat_code_id" integer,
	"currency" varchar(3),
	"amount_fx" numeric(18, 2),
	"fx_rate" numeric(18, 6)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(8) NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	CONSTRAINT "memberships_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"tax_number" varchar(20),
	"eu_vat_number" varchar(20),
	"country" varchar(2) DEFAULT 'HU' NOT NULL,
	"address" text,
	"is_private_person" boolean DEFAULT false NOT NULL,
	"email" varchar(255),
	"note" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"date" date NOT NULL,
	"money_account_id" integer NOT NULL,
	"amount_fx" numeric(18, 2) NOT NULL,
	"fx_rate" numeric(18, 6) DEFAULT 1 NOT NULL,
	"amount_huf" numeric(18, 2) NOT NULL,
	"partner_huf" numeric(18, 2) NOT NULL,
	"journal_entry_id" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"company_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" integer,
	CONSTRAINT "period_locks_company_id_year_month_pk" PRIMARY KEY("company_id","year","month")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vat_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(255) NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"kind" "vat_kind" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"vin" varchar(32),
	"plate" varchar(16),
	"make" varchar(64) NOT NULL,
	"model" varchar(64) NOT NULL,
	"year" integer,
	"vat_treatment" "vehicle_vat" DEFAULT 'margin' NOT NULL,
	"purchase_date" date,
	"purchase_price" numeric(18, 2),
	"status" "vehicle_status" DEFAULT 'in_stock' NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_vat_code_id_vat_codes_id_fk" FOREIGN KEY ("vat_code_id") REFERENCES "public"."vat_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vat_code_id_vat_codes_id_fk" FOREIGN KEY ("vat_code_id") REFERENCES "public"."vat_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_money_account_id_accounts_id_fk" FOREIGN KEY ("money_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_codes" ADD CONSTRAINT "vat_codes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_company_code" ON "accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_company_dir_partner_number" ON "invoices" USING btree ("company_id","direction","partner_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_company_fulfillment" ON "invoices" USING btree ("company_id","fulfillment_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_company_number" ON "journal_entries" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "journal_entries_company_date" ON "journal_entries" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_company_account" ON "journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "journal_lines_vehicle" ON "journal_lines" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_company_code" ON "journals" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "partners_company" ON "partners" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payments_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vat_codes_company_code" ON "vat_codes" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "vehicles_company" ON "vehicles" USING btree ("company_id");
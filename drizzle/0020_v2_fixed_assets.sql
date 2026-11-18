CREATE TABLE "asset_depreciation" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"period" varchar(7) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) NOT NULL,
	"kind" varchar(12) DEFAULT 'linear' NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"inventory_no" varchar(32),
	"serial_no" varchar(64),
	"account_code" varchar(12) NOT NULL,
	"activation_date" date NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"salvage" numeric(18, 2) DEFAULT 0 NOT NULL,
	"useful_life_months" integer DEFAULT 36 NOT NULL,
	"tax_rate_pct" numeric(6, 2),
	"method" varchar(12) DEFAULT 'linear' NOT NULL,
	"status" varchar(12) DEFAULT 'active' NOT NULL,
	"disposed_on" date,
	"location" varchar(128),
	"note" text,
	"opening_accumulated" numeric(18, 2) DEFAULT 0 NOT NULL,
	"opening_tax_accumulated" numeric(18, 2) DEFAULT 0 NOT NULL,
	"invoice_line_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_depreciation_period" ON "asset_depreciation" USING btree ("asset_id","period");--> statement-breakpoint
CREATE INDEX "fixed_assets_company" ON "fixed_assets" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_invoice_line" ON "fixed_assets" USING btree ("invoice_line_id");
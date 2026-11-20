CREATE TABLE "tax_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"form" varchar(12) NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"kind" varchar(16) DEFAULT 'original' NOT NULL,
	"source" varchar(12) DEFAULT 'import' NOT NULL,
	"file_name" varchar(255),
	"saved_at" timestamp,
	"signed_at" date,
	"kr_file_name" varchar(255),
	"template_ver" varchar(16),
	"sheets" jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"receipt_no" varchar(40),
	"note" text,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filings_hash" ON "tax_filings" USING btree ("company_id","sha256");--> statement-breakpoint
CREATE INDEX "tax_filings_period" ON "tax_filings" USING btree ("company_id","form","period_from");
CREATE TABLE "inbox_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source" varchar(10) NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"source_url" text,
	"kind" varchar(12) DEFAULT 'invoice' NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"data" text NOT NULL,
	"email_from" varchar(255),
	"email_subject" text,
	"email_date" timestamp with time zone,
	"status" varchar(12) DEFAULT 'new' NOT NULL,
	"extracted" jsonb,
	"proposal" jsonb,
	"invoice_id" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_settings" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_documents" ADD CONSTRAINT "inbox_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_documents" ADD CONSTRAINT "inbox_documents_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_documents_ref" ON "inbox_documents" USING btree ("company_id","source_ref");--> statement-breakpoint
CREATE INDEX "inbox_documents_status" ON "inbox_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "inbox_documents_sha" ON "inbox_documents" USING btree ("company_id","sha256");
CREATE TABLE "invoice_checks" (
	"invoice_id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"checked_at" timestamp with time zone,
	"checked_by" integer,
	"fingerprint" varchar(64),
	"note" text,
	"doc_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_checks" ADD CONSTRAINT "invoice_checks_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checks" ADD CONSTRAINT "invoice_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checks" ADD CONSTRAINT "invoice_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
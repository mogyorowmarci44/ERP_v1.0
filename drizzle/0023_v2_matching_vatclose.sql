CREATE TABLE "vat_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"payable" numeric(18, 2) NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "corrects_invoice_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" varchar(12) DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_closings" ADD CONSTRAINT "vat_closings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_closings_period" ON "vat_closings" USING btree ("company_id","to_date");--> statement-breakpoint
CREATE INDEX "payments_entry" ON "payments" USING btree ("journal_entry_id");
CREATE TABLE "member_loan_terms" (
	"entry_id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"due_date" date NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD CONSTRAINT "member_loan_terms_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD CONSTRAINT "member_loan_terms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
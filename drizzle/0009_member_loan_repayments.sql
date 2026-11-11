CREATE TABLE "member_loan_repayments" (
	"entry_id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"doc_no" varchar(30) NOT NULL,
	"allocations" jsonb,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "member_loan_repayments" ADD CONSTRAINT "member_loan_repayments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_loan_repayments" ADD CONSTRAINT "member_loan_repayments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
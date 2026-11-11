CREATE TABLE "member_loan_extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"extended_on" date NOT NULL,
	"days" integer NOT NULL,
	"from_due" date NOT NULL,
	"to_due" date NOT NULL,
	"doc_no" varchar(40) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_loan_fx" (
	"entry_id" integer PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"amount_fx" numeric(18, 2) DEFAULT 0 NOT NULL,
	"rate" numeric(18, 6)
);
--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD COLUMN "original_due_date" date;--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD COLUMN "contract_no" varchar(30);--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD COLUMN "currency" varchar(3);--> statement-breakpoint
ALTER TABLE "member_loan_terms" ADD COLUMN "amount_fx" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "member_loan_extensions" ADD CONSTRAINT "member_loan_extensions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_loan_extensions" ADD CONSTRAINT "member_loan_extensions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_loan_fx" ADD CONSTRAINT "member_loan_fx_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_loan_fx" ADD CONSTRAINT "member_loan_fx_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_loan_ext_seq" ON "member_loan_extensions" USING btree ("entry_id","seq");
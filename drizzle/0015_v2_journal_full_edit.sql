ALTER TABLE "journal_line_changes" DROP CONSTRAINT "journal_line_changes_line_id_journal_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "journal_line_changes" ALTER COLUMN "entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reuse_entry_number" varchar(32);--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "checked_by" integer;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD COLUMN "invoice_id" integer;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_line_id_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."journal_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_line_changes_invoice" ON "journal_line_changes" USING btree ("invoice_id");
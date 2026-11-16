CREATE TABLE "journal_line_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"line_id" integer,
	"field" varchar(20) NOT NULL,
	"old_value" text,
	"new_value" text,
	"user_id" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_line_id_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."journal_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line_changes" ADD CONSTRAINT "journal_line_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_line_changes_entry" ON "journal_line_changes" USING btree ("entry_id");
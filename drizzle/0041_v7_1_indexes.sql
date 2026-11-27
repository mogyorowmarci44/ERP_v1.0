-- v7.1.0 – indexek a gyakori összekapcsolásokhoz (számla ↔ naplótétel, partner-analitika, rendezések cégenként)
CREATE INDEX IF NOT EXISTS "invoices_journal_entry" ON "invoices" ("journal_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_company_partner" ON "journal_lines" ("company_id", "partner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_company" ON "payments" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_company_status_dir" ON "invoices" ("company_id", "status", "direction");

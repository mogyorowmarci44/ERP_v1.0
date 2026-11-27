-- v7.3.0 – banki párosítási szabályok és fizetési emlékeztetők
CREATE TABLE IF NOT EXISTS "bank_rules" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "pattern" varchar(120) NOT NULL,
  "direction" varchar(3) NOT NULL DEFAULT 'any',
  "account_code" varchar(10) NOT NULL,
  "label" varchar(120),
  "active" boolean NOT NULL DEFAULT true,
  "hits" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_rules_company" ON "bank_rules" ("company_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_reminders" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "invoice_id" integer NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_to" varchar(200) NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_reminders_invoice" ON "payment_reminders" ("invoice_id");

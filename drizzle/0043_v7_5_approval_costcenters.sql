-- v7.5.0 – jóváhagyás kifizetés előtt, költséghelyek / projektek
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "code" varchar(20) NOT NULL,
  "name" varchar(120) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_company_code" ON "cost_centers" ("company_id", "code");--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_cost_center" ON "journal_lines" ("cost_center_id") WHERE "cost_center_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "approved_by" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- az adatelkülönítési triggerek a költséghelyre is
CREATE OR REPLACE FUNCTION tenant_guard_journal_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_same_company('journal_entries', NEW.entry_id, NEW.company_id);
  PERFORM assert_same_company('accounts', NEW.account_id, NEW.company_id);
  PERFORM assert_same_company('partners', NEW.partner_id, NEW.company_id);
  PERFORM assert_same_company('vehicles', NEW.vehicle_id, NEW.company_id);
  PERFORM assert_same_company('vat_codes', NEW.vat_code_id, NEW.company_id);
  PERFORM assert_same_company('cost_centers', NEW.cost_center_id, NEW.company_id);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION tenant_guard_invoice_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer;
BEGIN
  SELECT company_id INTO cid FROM invoices WHERE id = NEW.invoice_id;
  PERFORM assert_same_company('accounts', NEW.account_id, cid);
  PERFORM assert_same_company('vat_codes', NEW.vat_code_id, cid);
  PERFORM assert_same_company('vehicles', NEW.vehicle_id, cid);
  PERFORM assert_same_company('items', NEW.item_id, cid);
  PERFORM assert_same_company('cost_centers', NEW.cost_center_id, cid);
  RETURN NEW;
END $$;

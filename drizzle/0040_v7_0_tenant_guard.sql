-- v7.0.0 – adatelkülönítés adatbázis-szinten: egy tétel csak a SAJÁT cégének főkönyvi számlájára,
-- partnerére, gépkocsijára, ÁFA-kódjára, cikkére, számlájára hivatkozhat (akkor is, ha az alkalmazás hibázna).
CREATE OR REPLACE FUNCTION assert_same_company(tbl regclass, rid integer, cid integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c integer;
BEGIN
  IF rid IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT company_id FROM %s WHERE id = $1', tbl) INTO c USING rid;
  IF c IS DISTINCT FROM cid THEN
    RAISE EXCEPTION 'Cégek közötti hivatkozás nem megengedett (%, #%).', tbl, rid USING ERRCODE = 'check_violation';
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_guard_journal_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_same_company('journal_entries', NEW.entry_id, NEW.company_id);
  PERFORM assert_same_company('accounts', NEW.account_id, NEW.company_id);
  PERFORM assert_same_company('partners', NEW.partner_id, NEW.company_id);
  PERFORM assert_same_company('vehicles', NEW.vehicle_id, NEW.company_id);
  PERFORM assert_same_company('vat_codes', NEW.vat_code_id, NEW.company_id);
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_guard ON journal_lines;--> statement-breakpoint
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON journal_lines FOR EACH ROW EXECUTE FUNCTION tenant_guard_journal_lines();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_guard_invoice_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer;
BEGIN
  SELECT company_id INTO cid FROM invoices WHERE id = NEW.invoice_id;
  PERFORM assert_same_company('accounts', NEW.account_id, cid);
  PERFORM assert_same_company('vat_codes', NEW.vat_code_id, cid);
  PERFORM assert_same_company('vehicles', NEW.vehicle_id, cid);
  PERFORM assert_same_company('items', NEW.item_id, cid);
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_guard ON invoice_lines;--> statement-breakpoint
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION tenant_guard_invoice_lines();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_guard_invoices() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_same_company('partners', NEW.partner_id, NEW.company_id);
  PERFORM assert_same_company('invoices', NEW.corrects_invoice_id, NEW.company_id);
  PERFORM assert_same_company('journal_entries', NEW.journal_entry_id, NEW.company_id);
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_guard ON invoices;--> statement-breakpoint
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION tenant_guard_invoices();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_guard_payments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_same_company('invoices', NEW.invoice_id, NEW.company_id);
  PERFORM assert_same_company('accounts', NEW.money_account_id, NEW.company_id);
  PERFORM assert_same_company('journal_entries', NEW.journal_entry_id, NEW.company_id);
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_guard ON payments;--> statement-breakpoint
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION tenant_guard_payments();--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_guard_stock_moves() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_same_company('items', NEW.item_id, NEW.company_id);
  PERFORM assert_same_company('journal_entries', NEW.journal_entry_id, NEW.company_id);
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS tenant_guard ON stock_moves;--> statement-breakpoint
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE ON stock_moves FOR EACH ROW EXECUTE FUNCTION tenant_guard_stock_moves();

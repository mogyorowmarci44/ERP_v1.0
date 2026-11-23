-- v3.9.6 – Önadózás (fordított adózás / KBB): a sor „bruttója” a partner felé fizetendő (= nettó), a számlafejjel egyezően
UPDATE "invoice_lines" il SET "gross_huf" = il."net_huf"
FROM "vat_codes" vc WHERE vc."id" = il."vat_code_id" AND vc."kind" IN ('reverse_charge', 'eu_acquisition') AND il."gross_huf" <> il."net_huf";
--> statement-breakpoint
-- Egy főkönyvi sorban vagy Tartozik, vagy Követel összeg lehet
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side" CHECK ("debit" = 0 OR "credit" = 0);
--> statement-breakpoint
-- A tétel T = K egyensúlya adatbázis-szinten is (a tranzakció végén ellenőrizve)
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid integer := coalesce(NEW.entry_id, OLD.entry_id); diff numeric;
BEGIN
  SELECT coalesce(sum(debit), 0) - coalesce(sum(credit), 0) INTO diff FROM journal_lines WHERE entry_id = eid;
  IF abs(diff) >= 0.005 THEN
    RAISE EXCEPTION 'A(z) % azonosítójú főkönyvi tétel nem egyensúlyos (T − K = %).', eid, diff;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

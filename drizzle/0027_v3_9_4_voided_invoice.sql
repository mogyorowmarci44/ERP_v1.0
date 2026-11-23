ALTER TABLE "invoices" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
-- A már rögzített rontott papírszámlák (megjegyzés szerint) rontottnak jelölése
UPDATE "invoices" SET "voided_at" = now() WHERE "status" = 'draft' AND "note" ILIKE 'Érvénytelenített (rontott)%';
--> statement-breakpoint
-- A szándékosan készleten tartott Jaguar kihagyása a napi összefoglalóból
UPDATE "companies" c SET "settings" = jsonb_set(coalesce(c."settings", '{}'::jsonb), '{summaryExcludeVehicles}',
  (SELECT coalesce(jsonb_agg(v."id"), '[]'::jsonb) FROM "vehicles" v WHERE v."company_id" = c."id" AND v."make" ILIKE 'Jaguar%' AND v."status" <> 'sold'))
WHERE EXISTS (SELECT 1 FROM "vehicles" v WHERE v."company_id" = c."id" AND v."make" ILIKE 'Jaguar%' AND v."status" <> 'sold');

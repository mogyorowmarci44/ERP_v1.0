-- v6.4.0 – Központi jogszabályi paraméterek dátum szerinti hatállyal (az üzemeltető tartja karban, minden ügyfélre érvényes)
CREATE TABLE IF NOT EXISTS "legal_params" (
  "key" varchar(64) NOT NULL,
  "valid_from" date NOT NULL,
  "value" numeric(18, 6) NOT NULL,
  "note" text,
  "updated_by" integer,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "legal_params_pk" PRIMARY KEY ("key", "valid_from")
);
--> statement-breakpoint
-- az eddigi (cégtulajdonos által szerkeszthető, de minden cégre ható) évenkénti bérparaméterek átvétele
INSERT INTO "legal_params" ("key", "valid_from", "value", "note")
SELECT 'payroll.' || kv.key, make_date(p.year, 1, 1), kv.value::numeric, 'átvéve a korábbi bérparaméterekből'
FROM "payroll_params" p, jsonb_each_text(p."values") kv
WHERE kv.key <> 'memberTbAccount' AND kv.value ~ '^-?[0-9]+(\.[0-9]+)?$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- a társas vállalkozó helyett viselt járulék költségszámlája cégbeállítás lesz (ha eltért az alapértéktől, minden cégre átvesszük)
UPDATE "companies" c SET "settings" = c."settings" || jsonb_build_object('payrollMemberTbAccount', x.acc)
FROM (SELECT p."values"->>'memberTbAccount' AS acc FROM "payroll_params" p WHERE p."values" ? 'memberTbAccount' ORDER BY p.year DESC LIMIT 1) x
WHERE x.acc IS NOT NULL AND x.acc <> '551' AND NOT (c."settings" ? 'payrollMemberTbAccount');

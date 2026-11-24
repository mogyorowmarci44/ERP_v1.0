-- v4.5.0 – Tagok és tisztségviselők (jogviszony, tulajdonrész, személyes adatok)
CREATE TABLE IF NOT EXISTS "company_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" varchar(255) NOT NULL,
  "partner_id" integer REFERENCES "partners"("id") ON DELETE set null,
  "is_member" boolean DEFAULT true NOT NULL,
  "is_ceo" boolean DEFAULT false NOT NULL,
  "share_pct" numeric(7, 4),
  "capital" numeric(18, 2),
  "start_date" date,
  "end_date" date,
  "representation" varchar(12),
  "birth_place" varchar(120),
  "birth_date" date,
  "mother_name" varchar(255),
  "address" text,
  "tax_id" varchar(20),
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_members_company" ON "company_members" ("company_id");

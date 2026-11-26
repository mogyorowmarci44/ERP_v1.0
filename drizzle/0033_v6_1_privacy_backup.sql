-- v6.1.0 – Érzékeny személyes adatok titkosított tárolása (a titkosított érték hosszabb, ezért text), ÁSZF-elfogadás
ALTER TABLE "employees" ALTER COLUMN "tax_id" TYPE text;
--> statement-breakpoint
ALTER TABLE "company_members" ALTER COLUMN "tax_id" TYPE text;
--> statement-breakpoint
ALTER TABLE "company_members" ALTER COLUMN "birth_place" TYPE text;
--> statement-breakpoint
ALTER TABLE "company_members" ALTER COLUMN "mother_name" TYPE text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_version" varchar(20);

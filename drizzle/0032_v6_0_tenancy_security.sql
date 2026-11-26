-- v6.0.0 – Ügyfélfiókok (szervezetek), belépésvédelem, jelszó-visszaállítás / meghívó, tevékenységnapló, archiválás
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "mfa_required" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "archived_by" integer;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "last_full_export_at" timestamp with time zone;
--> statement-breakpoint
-- Meglévő adatok: egyetlen ügyfélfiók; a 2FA-kötelezettség az eddigi rendszerszintű beállításból
DO $$
DECLARE oid integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "organization_id" IS NULL) OR EXISTS (SELECT 1 FROM "companies" WHERE "organization_id" IS NULL) THEN
    SELECT "id" INTO oid FROM "organizations" ORDER BY "id" LIMIT 1;
    IF oid IS NULL THEN
      INSERT INTO "organizations" ("name", "mfa_required")
      VALUES ('Mogyorosi Holding', COALESCE((SELECT ("value")::text <> 'false' FROM "app_settings" WHERE "key" = 'mfaRequired'), true))
      RETURNING "id" INTO oid;
    END IF;
    UPDATE "users" SET "organization_id" = oid WHERE "organization_id" IS NULL;
    UPDATE "companies" SET "organization_id" = oid WHERE "organization_id" IS NULL;
    UPDATE "users" SET "is_platform_admin" = true WHERE "is_admin" = true;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_org_idx" ON "companies" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_org_idx" ON "users" ("organization_id");
--> statement-breakpoint
-- Belépési próbálkozások számlálója (kulcs: email:… vagy ip:…)
CREATE TABLE IF NOT EXISTS "auth_throttle" (
  "key" varchar(320) PRIMARY KEY NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "window_start" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_until" timestamp with time zone
);
--> statement-breakpoint
-- Egyszer használható linkek: jelszó-visszaállítás és meghívó (csak a token SHA-256 hash-e tárolódik)
CREATE TABLE IF NOT EXISTS "user_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" varchar(16) NOT NULL,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tokens_user_idx" ON "user_tokens" ("user_id");
--> statement-breakpoint
-- Tevékenységnapló: szándékosan idegen kulcs nélkül, hogy a felhasználó / cég törlése után is megmaradjon
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "organization_id" integer,
  "company_id" integer,
  "user_id" integer,
  "user_email" varchar(255),
  "action" varchar(64) NOT NULL,
  "ok" boolean DEFAULT true NOT NULL,
  "target" varchar(255),
  "details" jsonb,
  "ip" varchar(64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_org_at_idx" ON "audit_log" ("organization_id", "at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_company_at_idx" ON "audit_log" ("company_id", "at" DESC);
--> statement-breakpoint
-- Üzemeltetői (támogatói) hozzáférés egy ügyfél cégéhez: időkorlátos, csak olvasás, naplózva
CREATE TABLE IF NOT EXISTS "support_grants" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_grants_user_company_idx" ON "support_grants" ("user_id", "company_id");

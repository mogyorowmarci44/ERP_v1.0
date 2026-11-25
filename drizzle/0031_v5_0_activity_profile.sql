-- v5.0.0 – Tevékenységprofil: autókereskedés vagy általános (tevékenységi kör még nem ismert)
DO $$ BEGIN
  CREATE TYPE "public"."activity_profile" AS ENUM('car_dealer', 'general');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "activity_profile" "activity_profile" DEFAULT 'car_dealer' NOT NULL;
--> statement-breakpoint
-- a meglévő társaságok (PezCar, MM Car Trade) autókereskedések; a magánszemély általános
UPDATE "companies" SET "activity_profile" = 'general' WHERE "entity_type" = 'private_taxpayer';
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "activity_profile" SET DEFAULT 'general';

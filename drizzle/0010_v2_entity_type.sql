CREATE TYPE "public"."entity_type" AS ENUM('company', 'private_taxpayer');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "entity_type" "entity_type" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_profile" jsonb;
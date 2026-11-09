ALTER TABLE "companies" ADD COLUMN "theme" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_data" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_mime" varchar(40);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_updated_at" timestamp with time zone;
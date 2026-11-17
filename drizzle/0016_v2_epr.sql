ALTER TABLE "vehicles" ADD COLUMN "epr_category" varchar(4);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "epr_drive" varchar(8);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "epr_mass_kg" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "epr_origin" varchar(12);
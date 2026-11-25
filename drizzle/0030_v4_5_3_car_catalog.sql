-- v4.5.3 – Típuskatalógus: márkák, modellek, motorváltozatok (évjárat-intervallum, motor, teljesítmény, váltó, tömeg)
CREATE TABLE IF NOT EXISTS "car_makes" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(80) NOT NULL,
  "ha_id" integer,
  "ha_count" integer,
  "ha_counted_at" date,
  CONSTRAINT "car_makes_name" UNIQUE ("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "car_models" (
  "id" serial PRIMARY KEY NOT NULL,
  "make_id" integer NOT NULL REFERENCES "car_makes"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "ha_id" integer,
  "ha_count" integer,
  CONSTRAINT "car_models_make_name" UNIQUE ("make_id", "name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "car_variants" (
  "id" serial PRIMARY KEY NOT NULL,
  "model_id" integer NOT NULL REFERENCES "car_models"("id") ON DELETE cascade,
  "source" varchar(20) NOT NULL DEFAULT 'auto-data',
  "source_id" integer NOT NULL,
  "generation" varchar(160) NOT NULL,
  "name" varchar(200) NOT NULL,
  "year_from" integer,
  "month_from" integer,
  "year_to" integer,
  "month_to" integer,
  "powertrain" varchar(12),
  "body" varchar(60),
  "fuel" varchar(20),
  "fuel_raw" varchar(80),
  "displacement_cc" integer,
  "power_hp" integer,
  "power_kw" integer,
  "engine_code" varchar(80),
  "drive" varchar(8),
  "gears" integer,
  "gearbox" varchar(12),
  "gearbox_raw" varchar(120),
  "kerb_min_kg" integer,
  "kerb_max_kg" integer,
  "gross_kg" integer,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "car_variants_source" UNIQUE ("source", "source_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "car_variants_model_years" ON "car_variants" ("model_id", "year_from", "year_to");

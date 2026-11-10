CREATE TABLE "forecast_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"category" varchar(16) DEFAULT 'expense' NOT NULL,
	"description" varchar(200) NOT NULL,
	"account_code" varchar(10),
	"partner_name" varchar(200),
	"net" numeric(18, 2) NOT NULL,
	"vat_rate" integer DEFAULT 0 NOT NULL,
	"deductible" boolean DEFAULT true NOT NULL,
	"frequency" varchar(10) DEFAULT 'monthly' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"payment" varchar(8) DEFAULT 'bank' NOT NULL,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_plan_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"date" date,
	"net" numeric(18, 2) NOT NULL,
	"vat_rate" integer DEFAULT 27 NOT NULL,
	"deductible" boolean DEFAULT true NOT NULL,
	"capitalize" boolean DEFAULT true NOT NULL,
	"payment" varchar(8) DEFAULT 'cash' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"vehicle_id" integer,
	"label" varchar(128),
	"purchase_date" date,
	"purchase_price" numeric(18, 2),
	"purchase_payment" varchar(8) DEFAULT 'cash' NOT NULL,
	"sale_price" numeric(18, 2),
	"sale_date" date,
	"sale_payment" varchar(8) DEFAULT 'bank' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_settings" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_items" ADD CONSTRAINT "forecast_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_plan_costs" ADD CONSTRAINT "forecast_plan_costs_plan_id_forecast_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."forecast_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_plans" ADD CONSTRAINT "forecast_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_plans" ADD CONSTRAINT "forecast_plans_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_settings" ADD CONSTRAINT "forecast_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_items_company" ON "forecast_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "forecast_plan_costs_plan" ON "forecast_plan_costs" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "forecast_plans_company" ON "forecast_plans" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_plans_vehicle" ON "forecast_plans" USING btree ("vehicle_id");
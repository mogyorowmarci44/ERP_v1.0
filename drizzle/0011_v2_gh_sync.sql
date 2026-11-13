CREATE TABLE "gh_ad_stats" (
	"company_id" integer NOT NULL,
	"date" date NOT NULL,
	"spend" numeric(18, 2) DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gh_ad_stats_company_id_date_pk" PRIMARY KEY("company_id","date")
);
--> statement-breakpoint
CREATE TABLE "gh_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source" varchar(16) NOT NULL,
	"code" varchar(60) NOT NULL,
	"guest" text,
	"guests" integer,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"amount" numeric(18, 2),
	"status" varchar(20) DEFAULT 'confirmed' NOT NULL,
	"booked_on" date,
	"note" text,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source" varchar(16) DEFAULT 'airbnb' NOT NULL,
	"external_id" varchar(60) NOT NULL,
	"guest" text,
	"guest_location" text,
	"stay_from" date,
	"stay_to" date,
	"reviewed_at" date NOT NULL,
	"overall" integer,
	"ratings" jsonb,
	"tags" jsonb,
	"text" text,
	"private_note" text,
	"reply" text,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gh_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"source" varchar(24) NOT NULL,
	"ok" boolean NOT NULL,
	"message" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gh_ad_stats" ADD CONSTRAINT "gh_ad_stats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_reservations" ADD CONSTRAINT "gh_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_reviews" ADD CONSTRAINT "gh_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_sync_log" ADD CONSTRAINT "gh_sync_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gh_reservations_code_uq" ON "gh_reservations" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "gh_reviews_ext_uq" ON "gh_reviews" USING btree ("company_id","external_id");
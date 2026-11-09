CREATE TABLE "fx_rates" (
	"currency" varchar(3) NOT NULL,
	"date" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" varchar(10) DEFAULT 'MNB' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" varchar(3) DEFAULT 'HUF' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rate_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "rate_source" varchar(10) DEFAULT 'MNB' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "periodic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "accounts" SET "currency" = 'EUR' WHERE "code" IN ('3811', '3841');
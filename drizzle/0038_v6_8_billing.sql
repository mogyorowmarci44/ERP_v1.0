-- v6.8.0 – Előfizetés: csomagok (üzemeltető állítja), ügyfélfiókonkénti állapot, Stripe
CREATE TABLE IF NOT EXISTS "plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" varchar(32) NOT NULL UNIQUE,
  "name" varchar(120) NOT NULL,
  "description" text,
  "price_huf" integer NOT NULL,
  "interval" varchar(8) DEFAULT 'month' NOT NULL,
  "stripe_price_id" varchar(120),
  "max_companies" integer,
  "max_users" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "plan_id" integer REFERENCES "plans"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "sub_status" varchar(12) DEFAULT 'trialing' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "past_due_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_email" varchar(255);
--> statement-breakpoint
-- a meglévő ügyfélfiókok (az üzemeltetőé is) díjmentesek; az újak 14 napos próbaidővel indulnak (alkalmazásszinten)
UPDATE "organizations" SET "sub_status" = 'comped' WHERE "trial_ends_at" IS NULL AND "sub_status" = 'trialing' AND "created_at" < now();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" varchar(80) PRIMARY KEY NOT NULL,
  "type" varchar(80) NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);

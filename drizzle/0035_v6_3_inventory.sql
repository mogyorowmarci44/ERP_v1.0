-- v6.3.0 – Általános készletnyilvántartás: cikktörzs, kézi készletmozgások, havi ELÁBÉ-könyvelések
CREATE TABLE IF NOT EXISTS "items" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "sku" varchar(64),
  "name" varchar(255) NOT NULL,
  "unit" varchar(16) DEFAULT 'db' NOT NULL,
  "stock_account" varchar(16) NOT NULL,
  "cogs_account" varchar(16) NOT NULL,
  "min_qty" numeric(18, 4),
  "is_active" boolean DEFAULT true NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_company_idx" ON "items" ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "items_company_sku_uq" ON "items" ("company_id", "sku") WHERE "sku" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "item_id" integer REFERENCES "items"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_item_idx" ON "invoice_lines" ("item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_moves" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "item_id" integer NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "kind" varchar(16) NOT NULL,
  "quantity" numeric(18, 4) NOT NULL,
  "unit_cost" numeric(18, 4),
  "journal_entry_id" integer REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "note" text,
  "created_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_moves_company_item_idx" ON "stock_moves" ("company_id", "item_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_cogs" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "stock_account" varchar(16) NOT NULL,
  "cogs_account" varchar(16) NOT NULL,
  "amount" numeric(18, 2) NOT NULL,
  "journal_entry_id" integer REFERENCES "journal_entries"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_cogs_company_period_idx" ON "stock_cogs" ("company_id", "period");

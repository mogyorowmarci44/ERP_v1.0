-- v6.7.0 – Bizonylatfájlok fájltárolóban; hibanapló
ALTER TABLE "inbox_documents" ALTER COLUMN "data" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_documents" ADD COLUMN IF NOT EXISTS "storage_key" varchar(255);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "error_log" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "message" text NOT NULL,
  "stack" text,
  "path" varchar(500),
  "method" varchar(10),
  "kind" varchar(32),
  "digest" varchar(64),
  "user_id" integer,
  "company_id" integer,
  "count" integer DEFAULT 1 NOT NULL,
  "last_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "error_log_fingerprint_open" ON "error_log" ("fingerprint") WHERE "resolved_at" IS NULL;

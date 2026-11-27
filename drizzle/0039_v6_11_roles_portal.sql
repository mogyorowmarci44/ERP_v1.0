-- v6.11.0 – modulonkénti jogosultság és bizonylatfeltöltő szerep (mobilos ügyfélportál)
ALTER TYPE "member_role" ADD VALUE IF NOT EXISTS 'uploader';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "hidden_modules" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_documents" ADD COLUMN IF NOT EXISTS "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_documents_uploader" ON "inbox_documents" ("company_id", "uploaded_by");

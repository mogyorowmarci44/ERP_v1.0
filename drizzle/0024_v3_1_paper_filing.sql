ALTER TABLE "inbox_documents" ADD COLUMN "filing_no" varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_documents_filing" ON "inbox_documents" USING btree ("company_id","filing_no");
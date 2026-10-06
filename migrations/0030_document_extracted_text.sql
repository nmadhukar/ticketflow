-- Migration: extracted_text on help_documents and company_policies (R90, task MCP4)
-- An uploaded .docx, .pdf, .txt or .md is stored as base64 in file_data, which nothing searched:
-- an uploaded help document was invisible to search and to MCP. extracted_text holds the file's
-- text (at most 1,000,000 characters), written by the server on create and update and filled for
-- existing rows by the startup backfill. NULL means no text: no file, an unsupported type, or a
-- file that did not parse.
-- Numbered 0030 on purpose: 0023 is held by an open branch; scripts/apply-sql-migrations.mjs
-- applies files in name order and does not require consecutive numbers (0014 is followed by 0018).
-- Production applies the schema with drizzle-kit push (shared/schema.ts, extractedText); this file
-- runs first (db:migrate-sql) and is the idempotent record: safe to run again, and it never aborts
-- (a missing table is reported with a NOTICE and skipped).
DO $$
BEGIN
  IF to_regclass('help_documents') IS NOT NULL THEN
    ALTER TABLE "help_documents" ADD COLUMN IF NOT EXISTS "extracted_text" text;
  ELSE
    RAISE NOTICE '0030: table help_documents is absent; extracted_text not added';
  END IF;
  IF to_regclass('company_policies') IS NOT NULL THEN
    ALTER TABLE "company_policies" ADD COLUMN IF NOT EXISTS "extracted_text" text;
  ELSE
    RAISE NOTICE '0030: table company_policies is absent; extracted_text not added';
  END IF;
END $$;

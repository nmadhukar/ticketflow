-- Migration: safe ticket numbers. A per-prefix, per-year counter replaces
-- "string-sorted max + 1". Production applies the schema with drizzle-kit push;
-- this file is the idempotent record, and getNextTicketNumber also seeds a
-- missing row from the numeric max, so it is correct without this file.

CREATE TABLE IF NOT EXISTS "ticket_number_counters" (
  "prefix" varchar(20) NOT NULL,
  "year" integer NOT NULL,
  "last_number" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "ticket_number_counters_prefix_year_pk" PRIMARY KEY ("prefix", "year")
);

-- Backfill from the highest NUMERIC suffix per prefix and year (never lowers an existing counter).
INSERT INTO "ticket_number_counters" ("prefix", "year", "last_number")
SELECT split_part("ticket_number", '-', 1),
       split_part("ticket_number", '-', 2)::integer,
       MAX(split_part("ticket_number", '-', 3)::integer)
FROM "tasks"
WHERE "ticket_number" ~ '^[A-Za-z0-9]+-[0-9]{4}-[0-9]+$'
  AND length(split_part("ticket_number", '-', 3)) <= 9
GROUP BY 1, 2
ON CONFLICT ("prefix", "year")
DO UPDATE SET "last_number" = GREATEST("ticket_number_counters"."last_number", EXCLUDED."last_number");

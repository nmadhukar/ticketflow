-- Migration: Add status/source and metrics to knowledge_articles; backfill values

ALTER TABLE knowledge_articles
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS helpful_votes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unhelpful_votes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_used TIMESTAMP NULL;

-- Backfill status from legacy is_published
UPDATE knowledge_articles
SET status = CASE WHEN is_published = TRUE THEN 'published' ELSE 'draft' END
WHERE status IS NULL OR status NOT IN ('draft','published','archived');

-- Backfill source as manual for existing rows
UPDATE knowledge_articles
SET source = 'manual'
WHERE source IS NULL OR source NOT IN ('manual','ai_generated');

-- Effectiveness score normalization: ensure decimal stored as 0-1
UPDATE knowledge_articles
SET effectiveness_score = '0.00'
WHERE effectiveness_score IS NULL;

-- Optional indexes to support filters
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_status ON knowledge_articles(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_source ON knowledge_articles(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(category);


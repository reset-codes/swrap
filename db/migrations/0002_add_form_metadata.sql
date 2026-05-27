-- Migration 0002: add form metadata columns
-- Adds content_digest and size_bytes to forms table to align with FormRecord.

ALTER TABLE forms ADD COLUMN IF NOT EXISTS content_digest TEXT;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS size_bytes BIGINT DEFAULT 0;

-- Migration 050: Add CARES tracking tables
-- Purpose: Support CARES program tracking - registration, articles, fry shares
-- Issue: https://github.com/jra3/mulm/issues/277

-- Up

-- Extend species_collection with CARES columns
ALTER TABLE species_collection ADD COLUMN cares_registered_at DATETIME;
ALTER TABLE species_collection ADD COLUMN cares_photo_id INTEGER REFERENCES uploads(id);
ALTER TABLE species_collection ADD COLUMN cares_last_confirmed DATE;

-- Articles written about CARES species
CREATE TABLE cares_article (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  species_group_id INTEGER NOT NULL REFERENCES species_name_group(group_id),
  title TEXT NOT NULL,
  url TEXT,
  file_id INTEGER REFERENCES uploads(id),
  published_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (url IS NOT NULL OR file_id IS NOT NULL)
);

-- Fry sharing records for CARES species
CREATE TABLE cares_fry_share (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  species_group_id INTEGER NOT NULL REFERENCES species_name_group(group_id),
  recipient_name TEXT NOT NULL,
  recipient_member_id INTEGER REFERENCES members(id),
  recipient_club TEXT,
  share_date DATE NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_species_collection_cares ON species_collection(cares_registered_at) WHERE cares_registered_at IS NOT NULL;
CREATE INDEX idx_cares_article_member ON cares_article(member_id);
CREATE INDEX idx_cares_fry_share_member ON cares_fry_share(member_id, share_date);

-- Down

DROP INDEX IF EXISTS idx_cares_fry_share_member;
DROP INDEX IF EXISTS idx_cares_article_member;
DROP INDEX IF EXISTS idx_species_collection_cares;
DROP TABLE IF EXISTS cares_fry_share;
DROP TABLE IF EXISTS cares_article;

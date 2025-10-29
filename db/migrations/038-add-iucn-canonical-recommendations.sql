-- Migration: Add IUCN canonical name recommendations
-- This adds a table to track taxonomic name change recommendations from IUCN
-- When IUCN has a species under a different name than ours, we store a recommendation
-- for admins to review and optionally apply.
-- Related to synonym detection feature (continuation of Issue #179)

-- Up
--------------------------------------------------------------------------------

-- Create canonical name recommendations table
CREATE TABLE iucn_canonical_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  current_canonical_genus TEXT NOT NULL,
  current_canonical_species TEXT NOT NULL,
  suggested_canonical_genus TEXT NOT NULL,
  suggested_canonical_species TEXT NOT NULL,
  iucn_taxon_id INTEGER NOT NULL,
  iucn_url TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by INTEGER, -- member_id of admin who reviewed
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES members(id) ON DELETE SET NULL
);

-- Create indexes for efficient querying
CREATE INDEX idx_canonical_rec_group ON iucn_canonical_recommendations (group_id);
CREATE INDEX idx_canonical_rec_status ON iucn_canonical_recommendations (status);
CREATE INDEX idx_canonical_rec_created ON iucn_canonical_recommendations (created_at DESC);

-- Prevent duplicate pending recommendations for the same species
CREATE UNIQUE INDEX idx_canonical_rec_unique_pending
  ON iucn_canonical_recommendations (group_id, status)
  WHERE status = 'pending';

-- Down
--------------------------------------------------------------------------------
-- This table can be safely dropped as it only contains recommendations, not core data

DROP TABLE IF EXISTS iucn_canonical_recommendations;

-- Migration: Add species collection/inventory system
-- Purpose: Allow members to track species they keep (not just breed)
-- Issue: https://github.com/jra3/mulm/issues/212

-- Main collection table
CREATE TABLE IF NOT EXISTS species_collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0 AND quantity <= 999),
  acquired_date DATE NOT NULL DEFAULT CURRENT_DATE,
  removed_date DATE DEFAULT NULL,
  notes TEXT,
  images TEXT, -- JSON array of image metadata, max 5 images
  visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key constraints
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,

  -- Ensure unique entry per species per member (can re-add after removal)
  -- NULL removed_date means currently active, so we allow duplicates only when removed_date is set
  UNIQUE(member_id, group_id, removed_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_collection_member ON species_collection(member_id);
CREATE INDEX IF NOT EXISTS idx_collection_species ON species_collection(group_id);
CREATE INDEX IF NOT EXISTS idx_collection_visibility ON species_collection(visibility);
CREATE INDEX IF NOT EXISTS idx_collection_removed ON species_collection(removed_date);
CREATE INDEX IF NOT EXISTS idx_collection_updated ON species_collection(updated_at);

-- Index for finding current (not removed) entries
CREATE INDEX IF NOT EXISTS idx_collection_current ON species_collection(member_id, removed_date)
  WHERE removed_date IS NULL;

-- Index for species keeper count queries
CREATE INDEX IF NOT EXISTS idx_collection_keepers ON species_collection(group_id, visibility, removed_date)
  WHERE removed_date IS NULL AND visibility = 'public';
-- Migration: Make acquired_date optional in species collection
-- Purpose: Allow members to track species without requiring an acquisition date
-- Related: Issue #212 - feedback from testing

-- SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table
-- Save existing data
CREATE TABLE species_collection_backup AS SELECT * FROM species_collection;

-- Drop old table
DROP TABLE species_collection;

-- Recreate with acquired_date as nullable
CREATE TABLE species_collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0 AND quantity <= 999),
  acquired_date DATE DEFAULT NULL,  -- Changed: Now nullable
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
  UNIQUE(member_id, group_id, removed_date)
);

-- Restore data
INSERT INTO species_collection SELECT * FROM species_collection_backup;

-- Drop backup
DROP TABLE species_collection_backup;

-- Recreate indexes
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

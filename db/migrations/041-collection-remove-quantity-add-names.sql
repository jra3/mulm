-- Migration: Remove quantity and add support for non-canonical species
-- Purpose: Remove quantity tracking entirely and allow free-text species names
-- Related: Issue #212 - feedback from testing

-- SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table
-- Save existing data
CREATE TABLE species_collection_backup AS SELECT * FROM species_collection;

-- Drop old table
DROP TABLE species_collection;

-- Recreate with new schema
CREATE TABLE species_collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,

  -- group_id is now optional - NULL if using free-text names
  group_id INTEGER DEFAULT NULL,

  -- Free-text name fields for non-canonical species
  common_name TEXT DEFAULT NULL,
  scientific_name TEXT DEFAULT NULL,

  acquired_date DATE DEFAULT NULL,
  removed_date DATE DEFAULT NULL,
  notes TEXT,
  images TEXT, -- JSON array of image metadata, max 5 images
  visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key constraints
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,

  -- Must have either a group_id OR a common_name
  CHECK (group_id IS NOT NULL OR common_name IS NOT NULL),

  -- Ensure unique entry per species per member
  -- For canonical species: unique on (member_id, group_id) when active
  -- For non-canonical: unique on (member_id, common_name, scientific_name) when active
  UNIQUE(member_id, group_id, common_name, scientific_name, removed_date)
);

-- Restore data (quantity column will be dropped)
INSERT INTO species_collection (
  id, member_id, group_id, acquired_date, removed_date,
  notes, images, visibility, created_at, updated_at
)
SELECT
  id, member_id, group_id, acquired_date, removed_date,
  notes, images, visibility, created_at, updated_at
FROM species_collection_backup;

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

-- Index for species keeper count queries (canonical species only)
CREATE INDEX IF NOT EXISTS idx_collection_keepers ON species_collection(group_id, visibility, removed_date)
  WHERE removed_date IS NULL AND visibility = 'public' AND group_id IS NOT NULL;

-- Index for common name searches (non-canonical species)
CREATE INDEX IF NOT EXISTS idx_collection_common_name ON species_collection(common_name)
  WHERE common_name IS NOT NULL;

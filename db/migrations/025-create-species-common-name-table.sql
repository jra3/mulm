-- Up

-- Create separate table for species common names
-- This allows many-to-many relationship between species groups and common names
CREATE TABLE species_common_name (
  common_name_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  common_name TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  UNIQUE (group_id, common_name)
);

-- Index for searching by common name
CREATE INDEX idx_species_common_name_lookup ON species_common_name(common_name);

-- Index for finding all common names for a species
CREATE INDEX idx_species_common_name_group ON species_common_name(group_id);

-- Down
DROP INDEX IF EXISTS idx_species_common_name_group;
DROP INDEX IF EXISTS idx_species_common_name_lookup;
DROP TABLE IF EXISTS species_common_name;

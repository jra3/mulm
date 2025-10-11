-- Up

-- Create separate table for species scientific names
-- This allows many-to-many relationship between species groups and scientific names
CREATE TABLE species_scientific_name (
  scientific_name_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  scientific_name TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  UNIQUE (group_id, scientific_name)
);

-- Index for searching by scientific name
CREATE INDEX idx_species_scientific_name_lookup ON species_scientific_name(scientific_name);

-- Index for finding all scientific names for a species
CREATE INDEX idx_species_scientific_name_group ON species_scientific_name(group_id);

-- Down
DROP INDEX IF EXISTS idx_species_scientific_name_group;
DROP INDEX IF EXISTS idx_species_scientific_name_lookup;
DROP TABLE IF EXISTS species_scientific_name;

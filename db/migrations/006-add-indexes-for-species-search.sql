-- Up
-- Add indexes for species search functionality
-- These indexes optimize LIKE queries on species names

-- Index on common and scientific names for text searches
CREATE INDEX idx_species_name_common ON species_name (common_name);
CREATE INDEX idx_species_name_scientific ON species_name (scientific_name);

-- Foreign key index for efficient joins
CREATE INDEX idx_species_name_group_id ON species_name (group_id);

-- Down
DROP INDEX IF EXISTS idx_species_name_common;
DROP INDEX IF EXISTS idx_species_name_scientific;
DROP INDEX IF EXISTS idx_species_name_group_id;
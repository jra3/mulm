-- Up

-- Populate species_common_name from existing species_name data
-- Extract unique common names per group
INSERT INTO species_common_name (group_id, common_name)
SELECT DISTINCT group_id, common_name
FROM species_name
ON CONFLICT (group_id, common_name) DO NOTHING;

-- Populate species_scientific_name from existing species_name data
-- Extract unique scientific names per group
INSERT INTO species_scientific_name (group_id, scientific_name)
SELECT DISTINCT group_id, scientific_name
FROM species_name
ON CONFLICT (group_id, scientific_name) DO NOTHING;

-- Down

-- Clear the tables (but keep structure)
DELETE FROM species_scientific_name;
DELETE FROM species_common_name;

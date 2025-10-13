-- Drop legacy species_name table and species_name_id column from submissions
--
-- This completes the split schema migration (025-029) by removing the old paired
-- common_name/scientific_name table and the legacy FK column.
--
-- Prerequisites:
-- - Migration 029 must have completed successfully
-- - All submissions must have common_name_id and scientific_name_id populated
-- - Code must be updated to use new schema (see commit that includes this migration)

-- Drop the legacy FK column from submissions
ALTER TABLE submissions DROP COLUMN species_name_id;

-- Drop the legacy paired names table
DROP TABLE IF EXISTS species_name;

-- Drop the index (if it exists)
DROP INDEX IF EXISTS idx_submissions_species_name;

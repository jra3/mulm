-- Migration: Add cares_species bonus field to submissions
-- This allows tracking CARES species bonus at time of approval
-- CARES species get +5 bonus points (similar to first_time_species)

-- Up
--------------------------------------------------------------------------------

-- Add cares_species column to submissions table
ALTER TABLE submissions ADD COLUMN cares_species BOOLEAN DEFAULT 0;

-- Populate existing submissions with CARES status from species_name_group
-- Only update approved submissions where we can determine CARES status from the species
UPDATE submissions
SET cares_species = 1
WHERE approved_on IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM species_name_group sng
    LEFT JOIN species_common_name cn ON submissions.common_name_id = cn.common_name_id
    LEFT JOIN species_scientific_name scin ON submissions.scientific_name_id = scin.scientific_name_id
    WHERE (cn.group_id = sng.group_id OR scin.group_id = sng.group_id)
      AND sng.is_cares_species = 1
  );

-- Down
--------------------------------------------------------------------------------
-- To rollback: ALTER TABLE submissions DROP COLUMN cares_species;

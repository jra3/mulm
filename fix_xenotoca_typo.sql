-- Fix for Xenotaca -> Xenotoca typo in submissions table
-- This affects 3 submissions (IDs: 41, 69, 78)
-- All have correct points (15) and CARES status (1) already

-- First, verify the affected records
SELECT
  id,
  species_latin_name,
  species_common_name,
  points,
  cares_species,
  (SELECT display_name FROM members WHERE id = member_id) as member
FROM submissions
WHERE species_latin_name = 'Xenotaca doadrioi';

-- Apply the fix: correct the typo in species name
UPDATE submissions
SET species_latin_name = 'Xenotoca doadrioi'
WHERE species_latin_name = 'Xenotaca doadrioi';

-- Verify the fix
SELECT
  id,
  species_latin_name,
  species_common_name,
  points,
  cares_species,
  (SELECT display_name FROM members WHERE id = member_id) as member
FROM submissions
WHERE species_latin_name = 'Xenotoca doadrioi'
ORDER BY id;

-- Expected result: 3 rows updated
-- Submissions 41, 69, 78 should now have "Xenotoca doadrioi" instead of "Xenotaca doadrioi"
-- Migration: Fix Xenotaca -> Xenotoca typo in submissions
-- Date: 2025-11-14
-- Issue: 3 submissions have "Xenotaca doadrioi" instead of "Xenotoca doadrioi"
-- The correct species exists in species_name_group with group_id 2193

BEGIN TRANSACTION;

-- Log what we're about to change
SELECT
  'Before update:' as status,
  COUNT(*) as affected_rows,
  GROUP_CONCAT(id) as submission_ids
FROM submissions
WHERE species_latin_name = 'Xenotaca doadrioi';

-- Apply the correction
UPDATE submissions
SET species_latin_name = 'Xenotoca doadrioi'
WHERE species_latin_name = 'Xenotaca doadrioi';

-- Verify the update
SELECT
  'After update:' as status,
  COUNT(*) as corrected_rows,
  GROUP_CONCAT(id) as submission_ids
FROM submissions
WHERE species_latin_name = 'Xenotoca doadrioi'
  AND id IN (41, 69, 78);

-- Verify no more typos exist
SELECT
  'Remaining typos:' as check_type,
  COUNT(*) as count
FROM submissions
WHERE species_latin_name = 'Xenotaca doadrioi';

COMMIT;

-- To apply on production:
-- ssh BAP
-- sudo sqlite3 /mnt/basny-data/app/database/database.db < fix_xenotoca_typo.sql
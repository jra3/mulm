-- Migration: Ensure Limia perugiae submission matches canonical name
-- Date: 2025-11-14
-- Issue: Submission #29 should have "Limia perugiae" to match species database

BEGIN TRANSACTION;

-- Check current state
SELECT
  'Before:' as status,
  id,
  species_latin_name,
  species_common_name,
  points
FROM submissions
WHERE id = 29;

-- Update to canonical spelling if needed
UPDATE submissions
SET species_latin_name = 'Limia perugiae'
WHERE id = 29
  AND species_latin_name != 'Limia perugiae';

-- Verify the result
SELECT
  'After:' as status,
  id,
  species_latin_name,
  species_common_name,
  points
FROM submissions
WHERE id = 29;

SELECT changes() || ' rows updated' as result;

COMMIT;

-- To apply on production:
-- ssh BAP
-- sudo sqlite3 /mnt/basny-data/app/database/database.db < fix_limia_submission.sql
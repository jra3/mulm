-- Migration: Fix submissions with invalid point values (25 and 30)
-- Date: 2025-11-15
-- Issue: Some submissions have 25 or 30 base points, which are not valid BAP values

BEGIN TRANSACTION;

-- Show current state
SELECT 'Before fixes:' as status;
SELECT id, species_latin_name, points, 'Should be' as note,
  CASE
    WHEN id = 16 THEN '15 (Trichopodus trichopterus)'
    WHEN id = 31 THEN '10 (Macropodus opercularis)'
    WHEN id = 34 THEN '15 (Green Rhodactis)'
    WHEN id = 15 THEN '10 (Pethia padamya)'
    WHEN id = 30 THEN '10 (Danio rerio)'
  END as correct_points
FROM submissions
WHERE id IN (16, 31, 34, 15, 30)
ORDER BY id;

-- Fix 25-point submissions
UPDATE submissions
SET points = 15
WHERE id = 16; -- Trichopodus trichopterus (Opaline Gourami)

UPDATE submissions
SET points = 10
WHERE id = 31; -- Macropodus opercularis (Paradise Fish)

UPDATE submissions
SET points = 15
WHERE id = 34; -- Green Rhodactis (Green Mushroom coral)

-- Fix 30-point submissions
UPDATE submissions
SET points = 10
WHERE id = 15; -- Pethia padamya (Odessa Barb)

UPDATE submissions
SET points = 10
WHERE id = 30; -- Danio rerio (Longfin Leopard Danio)

-- Verify the fixes
SELECT 'After fixes:' as status;
SELECT id, species_latin_name, species_common_name, points
FROM submissions
WHERE id IN (16, 31, 34, 15, 30)
ORDER BY id;

-- Double-check no invalid point values remain
SELECT 'Checking for any remaining invalid points:' as status;
SELECT DISTINCT points
FROM submissions
WHERE approved_on IS NOT NULL
  AND points NOT IN (5, 10, 15, 20)
ORDER BY points;

SELECT changes() || ' total rows updated' as result;

COMMIT;

-- To apply on production:
-- ssh BAP
-- sudo sqlite3 /mnt/basny-data/app/database/database.db < fix_invalid_points.sql
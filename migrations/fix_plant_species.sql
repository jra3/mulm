-- Migration: Fix plant species entries and submissions
-- Date: 2025-11-14
-- Issue: Plant species had NULL base_points and one submission had incomplete name

BEGIN TRANSACTION;

-- 1. Update base points for Rotala rotundifolia (group 82)
--    Based on submission #42 by Denis Vardaro (15 points)
UPDATE species_name_group
SET base_points = 15
WHERE group_id = 82 AND canonical_genus = 'Rotala' AND canonical_species_name = 'rotundifolia';

-- 2. Update base points for Najas guadalupensis (group 16)
--    Based on submission #58 by Liz Puello (10 points)
UPDATE species_name_group
SET base_points = 10
WHERE group_id = 16 AND canonical_genus = 'Najas';

-- 3. Fix capitalization of species name (was 'Guadalupensis', should be 'guadalupensis')
UPDATE species_name_group
SET canonical_species_name = 'guadalupensis'
WHERE group_id = 16 AND canonical_genus = 'Najas';

-- 4. Update base points for Vallisneria sp. (group 84)
--    Based on submission #20 by James Longo (10 points)
UPDATE species_name_group
SET base_points = 10
WHERE group_id = 84 AND canonical_genus = 'Vallisneria' AND canonical_species_name = 'sp.';

-- 5. Fix the Vallisneria submission to match database entry
--    Change from 'Vallisneria' to 'Vallisneria sp.'
UPDATE submissions
SET species_latin_name = 'Vallisneria sp.'
WHERE id = 20 AND species_latin_name = 'Vallisneria';

-- Verification queries
SELECT 'Updated species:' as status;
SELECT
  group_id,
  canonical_genus || ' ' || canonical_species_name as species,
  base_points,
  program_class
FROM species_name_group
WHERE group_id IN (82, 16, 84);

SELECT 'Updated submissions:' as status;
SELECT
  id,
  species_latin_name,
  species_common_name,
  points
FROM submissions
WHERE id IN (20, 42, 58)
ORDER BY id;

COMMIT;

-- To apply on production:
-- ssh BAP
-- sudo sqlite3 /mnt/basny-data/app/database/database.db < fix_plant_species.sql
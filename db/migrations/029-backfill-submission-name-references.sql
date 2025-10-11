-- Up

-- Backfill common_name_id in submissions
-- Map from old species_name.name_id to new species_common_name.common_name_id
UPDATE submissions
SET common_name_id = (
  SELECT scn.common_name_id
  FROM species_name sn
  JOIN species_common_name scn ON sn.group_id = scn.group_id AND sn.common_name = scn.common_name
  WHERE sn.name_id = submissions.species_name_id
)
WHERE submissions.species_name_id IS NOT NULL;

-- Backfill scientific_name_id in submissions
-- Map from old species_name.name_id to new species_scientific_name.scientific_name_id
UPDATE submissions
SET scientific_name_id = (
  SELECT ssn.scientific_name_id
  FROM species_name sn
  JOIN species_scientific_name ssn ON sn.group_id = ssn.group_id AND sn.scientific_name = ssn.scientific_name
  WHERE sn.name_id = submissions.species_name_id
)
WHERE submissions.species_name_id IS NOT NULL;

-- Verify backfill worked
-- All submissions with species_name_id should now have both new FKs populated
-- (Query for validation, not enforced in migration)
-- SELECT COUNT(*) FROM submissions WHERE species_name_id IS NOT NULL AND (common_name_id IS NULL OR scientific_name_id IS NULL);

-- Down

-- Clear the backfilled data
UPDATE submissions SET common_name_id = NULL WHERE common_name_id IS NOT NULL;
UPDATE submissions SET scientific_name_id = NULL WHERE scientific_name_id IS NOT NULL;

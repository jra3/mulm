-- Up

-- A Canonical name is unique whatever its case (#423). Rename and merge
-- already treat "Poecilia reticulata" and "poecilia Reticulata" as one Name;
-- the table-level UNIQUE from 003 compares with BINARY, so create and rename
-- let a second Species take a case variant, and resolveSpecies then picked
-- one of the two by sort order.
--
-- If any Species already share a Canonical name up to case, building this
-- index fails with a UNIQUE constraint error and the migration does not run.
-- Merge the pair first. To list them:
--   SELECT LOWER(canonical_genus), LOWER(canonical_species_name), GROUP_CONCAT(group_id)
--   FROM species_name_group GROUP BY 1, 2 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX idx_species_name_group_canonical_nocase
  ON species_name_group (canonical_genus COLLATE NOCASE, canonical_species_name COLLATE NOCASE);

-- Down

DROP INDEX IF EXISTS idx_species_name_group_canonical_nocase;

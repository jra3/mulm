-- Up

-- Submissions reference their Species by species_id (058); the two Name
-- foreign keys go. The member's own spellings stay in species_common_name and
-- species_latin_name, as submitted.
DROP INDEX IF EXISTS idx_submissions_common_name;
DROP INDEX IF EXISTS idx_submissions_scientific_name;
ALTER TABLE submissions DROP COLUMN common_name_id;
ALTER TABLE submissions DROP COLUMN scientific_name_id;

-- Down

-- The keys come back pointing at a Name of the bound Species: its Canonical
-- name. Which Names they held before is not recoverable, but the Species
-- they lead to is the same.
ALTER TABLE submissions
  ADD COLUMN common_name_id INTEGER REFERENCES species_common_name(common_name_id) ON DELETE SET NULL;
ALTER TABLE submissions
  ADD COLUMN scientific_name_id INTEGER REFERENCES species_scientific_name(scientific_name_id) ON DELETE SET NULL;
CREATE INDEX idx_submissions_common_name ON submissions(common_name_id);
CREATE INDEX idx_submissions_scientific_name ON submissions(scientific_name_id);
UPDATE submissions
SET scientific_name_id = (
  SELECT sn.scientific_name_id FROM species_scientific_name sn
  WHERE sn.group_id = submissions.species_id AND sn.is_canonical = 1
);

-- Up

-- A Submission binds to its Species by id (spec #404). Until now it reached
-- its Species through whichever of its two Name foreign keys was set, common
-- first; species_id takes that answer over, and 059 drops the two keys.
--
-- RESTRICT: a Species is never deleted while a Submission references it. The
-- catalogue refuses the delete first; merging moves the Submissions to the
-- winner before the loser goes.
ALTER TABLE submissions
  ADD COLUMN species_id INTEGER REFERENCES species_name_group(group_id) ON DELETE RESTRICT;

CREATE INDEX idx_submissions_species ON submissions(species_id);

-- Exactly the old derivation: the common Name's Species, else the scientific
-- Name's, else none.
UPDATE submissions
SET species_id = COALESCE(
  (SELECT cn.group_id FROM species_common_name cn WHERE cn.common_name_id = submissions.common_name_id),
  (SELECT sn.group_id FROM species_scientific_name sn WHERE sn.scientific_name_id = submissions.scientific_name_id)
);

-- Down

DROP INDEX IF EXISTS idx_submissions_species;
ALTER TABLE submissions DROP COLUMN species_id;

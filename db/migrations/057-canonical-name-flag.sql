-- Up

-- The Canonical name becomes one of the Species' scientific Names, flagged
-- (ADR-0002). canonical_genus / canonical_species_name stay on
-- species_name_group as a cache the Species catalogue writes.
--
-- The partial unique index allows at most one flagged Name per Species; the
-- backfill below gives every Species exactly one, and the catalogue keeps it
-- that way on create, rename and merge.

ALTER TABLE species_scientific_name
  ADD COLUMN is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1));

CREATE UNIQUE INDEX idx_species_scientific_name_canonical
  ON species_scientific_name (group_id) WHERE is_canonical = 1;

-- Every flagged Name is the cache's text exactly: canonical_genus, one space,
-- canonical_species_name, as the catalogue's canonicalName() builds it. A
-- trinomial's epithet ("aeneus venezuelan") carries its own space. The text
-- is taken as it is, not trimmed or respaced: the catalogue trims both parts
-- on create and rename, and a production snapshot had no canonical column
-- with stray or doubled spaces.

-- 1. The Species already has its Canonical name as a scientific Name, in
--    the same case: flag that row. UNIQUE (group_id, scientific_name) means
--    there is at most one.
UPDATE species_scientific_name
SET is_canonical = 1
WHERE scientific_name_id IN (
  SELECT sn.scientific_name_id
  FROM species_scientific_name sn
  JOIN species_name_group g ON g.group_id = sn.group_id
  WHERE sn.scientific_name = g.canonical_genus || ' ' || g.canonical_species_name
);

-- 2. The Species has it only in another case ("caulastrea furcata" for
--    "Caulastrea furcata"). The catalogue treats a change of case as a
--    spelling fix of the same Name, so the row is flagged and its text set to
--    the Canonical spelling rather than a second row differing only in case
--    being added. Its id is kept, so Submissions referencing it keep
--    referencing it. With several such rows, the oldest is taken.
UPDATE species_scientific_name
SET is_canonical = 1,
    scientific_name = (
      SELECT g.canonical_genus || ' ' || g.canonical_species_name
      FROM species_name_group g
      WHERE g.group_id = species_scientific_name.group_id
    )
WHERE scientific_name_id IN (
  SELECT MIN(sn.scientific_name_id)
  FROM species_scientific_name sn
  JOIN species_name_group g ON g.group_id = sn.group_id
  WHERE LOWER(sn.scientific_name) = LOWER(g.canonical_genus || ' ' || g.canonical_species_name)
    AND NOT EXISTS (
      SELECT 1 FROM species_scientific_name f
      WHERE f.group_id = g.group_id AND f.is_canonical = 1
    )
  GROUP BY sn.group_id
);

-- 3. The Species does not have it as a scientific Name at all: add it.
INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical)
SELECT g.group_id, g.canonical_genus || ' ' || g.canonical_species_name, 1
FROM species_name_group g
WHERE NOT EXISTS (
  SELECT 1 FROM species_scientific_name f
  WHERE f.group_id = g.group_id AND f.is_canonical = 1
);

-- Down

-- The Names the backfill added and the case it corrected stay: they are
-- ordinary scientific Names without the flag.
DROP INDEX IF EXISTS idx_species_scientific_name_canonical;
ALTER TABLE species_scientific_name DROP COLUMN is_canonical;

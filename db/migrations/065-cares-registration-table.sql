-- Up

-- A CARES registration is a member's record of maintaining a CARES Species.
-- It was four columns on a collection entry, so unlinking or removing the
-- entry stranded it and re-adding the Species started over. It now stands on
-- its own, keyed like cares_article and cares_fry_share.
CREATE TABLE cares_registration (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  species_group_id INTEGER NOT NULL REFERENCES species_name_group(group_id),
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_confirmed DATE,
  photo_key TEXT,
  photo_url TEXT,
  UNIQUE (member_id, species_group_id)
);
CREATE INDEX idx_cares_registration_species ON cares_registration(species_group_id);

-- One registration per member and Species: a current entry's over a removed
-- one, then the earliest. The latest confirmation of any of them carries over.
INSERT INTO cares_registration
  (member_id, species_group_id, registered_at, last_confirmed, photo_key, photo_url)
SELECT member_id, group_id, cares_registered_at, confirmed, cares_photo_key, cares_photo_url
FROM (
  SELECT member_id, group_id, cares_registered_at, cares_photo_key, cares_photo_url,
    MAX(cares_last_confirmed) OVER (PARTITION BY member_id, group_id) AS confirmed,
    ROW_NUMBER() OVER (
      PARTITION BY member_id, group_id
      ORDER BY removed_date IS NOT NULL, cares_registered_at, id
    ) AS n
  FROM species_collection
  WHERE cares_registered_at IS NOT NULL AND group_id IS NOT NULL
)
WHERE n = 1;

DROP INDEX IF EXISTS idx_species_collection_cares;
ALTER TABLE species_collection DROP COLUMN cares_registered_at;
ALTER TABLE species_collection DROP COLUMN cares_last_confirmed;
ALTER TABLE species_collection DROP COLUMN cares_photo_key;
ALTER TABLE species_collection DROP COLUMN cares_photo_url;

-- Down

-- Each registration goes back onto the member's current entry for the
-- Species. One with no current entry is lost.
ALTER TABLE species_collection ADD COLUMN cares_registered_at DATETIME;
ALTER TABLE species_collection ADD COLUMN cares_last_confirmed DATE;
ALTER TABLE species_collection ADD COLUMN cares_photo_key TEXT;
ALTER TABLE species_collection ADD COLUMN cares_photo_url TEXT;
CREATE INDEX idx_species_collection_cares ON species_collection(cares_registered_at)
  WHERE cares_registered_at IS NOT NULL;
UPDATE species_collection
SET (cares_registered_at, cares_last_confirmed, cares_photo_key, cares_photo_url) = (
  SELECT r.registered_at, r.last_confirmed, r.photo_key, r.photo_url
  FROM cares_registration r
  WHERE r.member_id = species_collection.member_id
    AND r.species_group_id = species_collection.group_id
)
WHERE removed_date IS NULL;
DROP INDEX idx_cares_registration_species;
DROP TABLE cares_registration;

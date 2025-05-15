-- Up
CREATE TABLE species_name_group (
	group_id INTEGER PRIMARY KEY AUTOINCREMENT,
	program_class TEXT NOT NULL,
	canonical_genus TEXT NOT NULL,
	canonical_species_name TEXT NOT NULL,
	UNIQUE (canonical_genus, canonical_species_name)
);

CREATE TABLE species_name (
	name_id INTEGER PRIMARY KEY AUTOINCREMENT,
	group_id INTEGER
		REFERENCES species_name_group(group_id)
		ON DELETE CASCADE
		NOT NULL,
	common_name TEXT NOT NULL,
	scientific_name TEXT NOT NULL,
	UNIQUE (common_name, scientific_name)
);

ALTER TABLE submissions
  ADD COLUMN species_name_id INTEGER
    REFERENCES species_name(name_id)
    ON DELETE SET NULL
    DEFAULT NULL;

-- Down
DROP TABLE IF EXISTS species_name;
DROP TABLE IF EXISTS species_name_group;

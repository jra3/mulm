-- # Create your table with this file
-- > cd ~/mulm
-- > sqlite3 database.db < src/schema.sql

CREATE TABLE auto_increment (value INT, table_name TEXT);
INSERT INTO auto_increment VALUES (0, 'members');
INSERT INTO auto_increment VALUES (0, 'known_species');

CREATE TABLE submissions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	program TEXT NOT NULL,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	member_id INTEGER NOT NULL,
	species_type TEXT NOT NULL,
	species_class TEXT NOT NULL,
	species_common_name TEXT NOT NULL,
	species_latin_name TEXT NOT NULL,
	water_type TEXT NOT NULL,
	count TEXT,
	reproduction_date DATETIME NOT NULL,

	foods TEXT,
	spawn_locations TEXT,
	propagation_method TEXT,

	tank_size TEXT NOT NULL,
	filter_type TEXT NOT NULL,
	water_change_volume TEXT NOT NULL,
	water_change_frequency TEXT NOT NULL,
	temperature TEXT NOT NULL,
	ph TEXT NOT NULL,
	gh TEXT,
	specific_gravity TEXT,
	substrate_type TEXT NOT NULL,
	substrate_depth TEXT NOT NULL,
	substrate_color TEXT NOT NULL,

	light_type TEXT,
	light_strength TEXT,
	light_hours TEXT,

	co2 TEXT,
	co2_description TEXT,
	supplement_type TEXT,
	supplement_regimen TEXT,

	submitted_on DATETIME DEFAULT NULL,
	approved_on DATETIME DEFAULT NULL,
	approved_by INTEGER DEFAULT NULL,
	points INTEGER DEFAULT NULL

	article_points INTEGER DEFAULT NULL,

	first_time_spawn BOOLEAN DEFAULT NULL,
	flowered BOOLEAN DEFAULT NULL,
	sexual_reproduction BOOLEAN DEFAULT NULL,
);

CREATE INDEX idx_member_id ON submissions (member_id);
CREATE INDEX idx_date_approved ON submissions (approved_on);

/*
	Members table
	 - email is unique
	 - id is unique and managed automatically by trigger
*/

CREATE TABLE members (
	id INTEGER PRIMARY KEY AUTOINCREMENT,

	contact_email TEXT NOT NULL,
	display_name TEXT NOT NULL,

	is_admin INTEGER DEFAULT 0,

	fish_level TEXT DEFAULT NULL,
	plant_level TEXT DEFAULT NULL,
	coral_level	TEXT DEFAULT NULL,

	UNIQUE(contact_email)
);

CREATE TABLE google_account (
	google_sub TEXT PRIMARY KEY,
	member_id INTEGER NOT NULL
);

CREATE TRIGGER members_id_sequence AFTER INSERT ON members
BEGIN
	UPDATE auto_increment
	SET value = value + 1
	WHERE table_name = 'members';

	UPDATE members
	SET	id = (
		SELECT value
		FROM auto_increment
		WHERE table_name = 'members')
	WHERE   ROWID = new.ROWID;
END;

CREATE TABLE awards (
	member_id INTEGER NOT NULL,
	award_name TEXT NOT NULL,
	date_awarded DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (member_id, award_name)
);

CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY,
	member_id INTEGER,
	expires_on DATETIME NOT NULL
);

CREATE TABLE known_species (
	latin_name TEXT NOT NULL,
	common_name TEXT NOT NULL,
	id INTEGER NOT NULL,
	first_submission INTEGER NOT NULL,
	species_id INTEGER NOT NULL,
	PRIMARY KEY (latin_name, common_name)
);

CREATE INDEX idx_species_id ON known_species (species_id);

-- A link between 2 species names, grouping two entries that are the same fish
-- by 2 different names
CREATE TABLE known_species_assoc (
	authoritative_id INTEGER NOT NULL,
	alternate_id INTEGER NOT NULL,
	PRIMARY KEY (alternate_id)
);

CREATE INDEX idx_known_species_assoc_auth ON known_species_assoc (authoritative_id);

CREATE TRIGGER known_species_id_sequence AFTER INSERT ON known_species
BEGIN
	UPDATE auto_increment
	SET value = value + 1
	WHERE table_name = 'known_species';

	UPDATE known_species
	SET	id = (
		SELECT value
		FROM auto_increment
		WHERE table_name = 'known_species')
	WHERE   ROWID = new.ROWID;
END;

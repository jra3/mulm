-- # Create your table with this file
-- > cd ~/mulm
-- > sqlite3 database.db < src/schema.sql

CREATE TABLE auto_increment (value INT, table_name TEXT);
INSERT INTO auto_increment VALUES (0, 'members');

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
	count TEXT NOT NULL,

	tank_size TEXT NOT NULL,
	filter_type TEXT NOT NULL,
	water_change_volume TEXT NOT NULL,
	water_change_frequency TEXT NOT NULL,
	temperature TEXT NOT NULL,
	pH TEXT NOT NULL,
	GH TEXT NOT NULL,
	specific_gravity TEXT NOT NULL,
	substrate_type TEXT NOT NULL,
	substrate_depth TEXT NOT NULL,
	substrate_color TEXT NOT NULL,

	submitted_on DATETIME DEFAULT NULL,
	approved_on DATETIME DEFAULT NULL,
	approved_by INTEGER DEFAULT NULL,
	points INTEGER DEFAULT NULL
);

CREATE INDEX idx_member_id ON submissions (member_id);
CREATE INDEX idx_date_approved ON submissions (approved_on);

/*
	Members table
	 - email is unique
	 - id is unique and managed automatically by trigger
*/

CREATE TABLE members (
	email TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	id INTEGER UNIQUE,

	is_admin INTEGER DEFAULT 0,

	fish_level TEXT DEFAULT NULL,
	plant_level TEXT DEFAULT NULL,
	coral_level	TEXT DEFAULT NULL
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

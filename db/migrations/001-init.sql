-- Up

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

CREATE TABLE submissions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	program TEXT NOT NULL,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	member_id INTEGER
		REFERENCES members(id)
		ON DELETE SET NULL,
	species_type TEXT,
	species_class TEXT,
	species_common_name TEXT,
	species_latin_name TEXT,
	water_type TEXT,
	count TEXT,
	reproduction_date DATETIME,

	foods TEXT,
	spawn_locations TEXT,
	propagation_method TEXT,

	tank_size TEXT,
	filter_type TEXT,
	water_change_volume TEXT,
	water_change_frequency TEXT,
	temperature TEXT,
	ph TEXT,
	gh TEXT,
	specific_gravity TEXT,
	substrate_type TEXT,
	substrate_depth TEXT,
	substrate_color TEXT,

	light_type TEXT,
	light_strength TEXT,
	light_hours TEXT,

	co2 TEXT,
	co2_description TEXT,
	supplement_type TEXT,
	supplement_regimen TEXT,

	submitted_on DATETIME DEFAULT NULL,
	approved_on DATETIME DEFAULT NULL,
	approved_by INTEGER REFERENCES members(id)
		ON DELETE RESTRICT
		DEFAULT NULL,
	points INTEGER DEFAULT NULL,

	article_points INTEGER DEFAULT NULL,
	first_time_species BOOLEAN DEFAULT NULL,
	flowered BOOLEAN DEFAULT NULL,
	sexual_reproduction BOOLEAN DEFAULT NULL
);
CREATE INDEX idx_member_id ON submissions (member_id);
CREATE INDEX idx_date_approved ON submissions (approved_on);

CREATE TABLE awards (
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
	 	NOT NULL,
	award_name TEXT NOT NULL,
	date_awarded DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (member_id, award_name)
);

CREATE TABLE password_account (
	member_id INTEGER PRIMARY KEY
		REFERENCES members(id)
		ON DELETE CASCADE,
	N INTEGER NOT NULL,
	r INTEGER NOT NULL,
	p INTEGER NOT NULL,
	salt TEXT NOT NULL,
	hash TEXT NOT NULL
);

CREATE TABLE google_account (
	google_sub TEXT PRIMARY KEY,
	google_email TEXT,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	UNIQUE(member_id)
);
CREATE INDEX idx_google_member_id ON google_account (member_id);

CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	expires_on DATETIME NOT NULL
);

CREATE TABLE auth_codes (
	code TEXT PRIMARY KEY,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	purpose TEXT NOT NULL,
	expires_on DATETIME NOT NULL
);

-- Down

DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS password_account;
DROP TABLE IF EXISTS google_account;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS awards;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_codes;

-- # Create your table with this file
-- > cd ~/mulm
-- > sqlite3 database.db < src/schema.sql

CREATE TABLE submissions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	member_name TEXT NOT NULL,
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
	approved_by TEXT DEFAULT NULL,
	points INTEGER DEFAULT NULL
);

CREATE INDEX idx_member_name ON submissions (member_name);
CREATE INDEX idx_date_approved ON submissions (approved_on);

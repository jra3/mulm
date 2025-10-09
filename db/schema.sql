CREATE TABLE IF NOT EXISTS "migrations" (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL,
  up   TEXT    NOT NULL,
  down TEXT    NOT NULL
);
CREATE TABLE members (
	id INTEGER PRIMARY KEY AUTOINCREMENT,

	contact_email TEXT NOT NULL,
	display_name TEXT NOT NULL,

	is_admin INTEGER DEFAULT 0,

	fish_level TEXT DEFAULT NULL,
	plant_level TEXT DEFAULT NULL,
	coral_level	TEXT DEFAULT NULL, locked_until DATETIME DEFAULT NULL,

	UNIQUE(contact_email)
);
CREATE TABLE sqlite_sequence(name,seq);
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
, species_name_id INTEGER
    REFERENCES species_name(name_id)
    ON DELETE SET NULL
    DEFAULT NULL, witnessed_by INTEGER REFERENCES members(id) ON DELETE SET NULL, witnessed_on DATETIME, witness_verification_status TEXT 
    CHECK (witness_verification_status IN ('pending', 'confirmed', 'declined')) 
    DEFAULT 'pending', denied_on DATETIME DEFAULT NULL, denied_by INTEGER DEFAULT NULL REFERENCES members(id) ON DELETE RESTRICT, denied_reason TEXT DEFAULT NULL, images TEXT DEFAULT NULL);
CREATE TABLE awards (
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
	 	NOT NULL,
	award_name TEXT NOT NULL,
	date_awarded DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, award_type TEXT DEFAULT 'species' CHECK (award_type IN ('species', 'meta_species', 'manual')),
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
CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	expires_on DATETIME NOT NULL
, oauth_state TEXT DEFAULT NULL);
CREATE TABLE auth_codes (
	code TEXT PRIMARY KEY,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	purpose TEXT NOT NULL,
	expires_on DATETIME NOT NULL
);
CREATE TABLE tank_presets (
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE,
	preset_name TEXT NOT NULL,

	created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

	tank_size TEXT DEFAULT NULL,
	filter_type TEXT DEFAULT NULL,
	water_change_volume TEXT DEFAULT NULL,
	water_change_frequency TEXT DEFAULT NULL,
	temperature TEXT DEFAULT NULL,
	ph TEXT DEFAULT NULL,
	gh TEXT DEFAULT NULL,
	specific_gravity TEXT DEFAULT NULL,
	substrate_type TEXT DEFAULT NULL,
	substrate_depth TEXT DEFAULT NULL,
	substrate_color TEXT DEFAULT NULL,

	PRIMARY KEY (member_id, preset_name)
);
CREATE TABLE species_name_group (
	group_id INTEGER PRIMARY KEY AUTOINCREMENT,
	program_class TEXT NOT NULL,
	canonical_genus TEXT NOT NULL,
	canonical_species_name TEXT NOT NULL, species_type TEXT, base_points INTEGER DEFAULT NULL, external_references TEXT DEFAULT NULL, image_links TEXT DEFAULT NULL, is_cares_species INTEGER DEFAULT 0,
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
CREATE INDEX idx_member_id ON submissions (member_id);
CREATE INDEX idx_date_approved ON submissions (approved_on);
CREATE INDEX idx_google_member_id ON google_account (member_id);
CREATE INDEX idx_member_contact_email ON members (contact_email);
CREATE INDEX idx_member_display_name ON members (display_name);
CREATE INDEX idx_species_name_common ON species_name (common_name);
CREATE INDEX idx_species_name_scientific ON species_name (scientific_name);
CREATE INDEX idx_species_name_group_id ON species_name (group_id);
CREATE TABLE activity_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('submission_approved', 'award_granted')),
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,
    related_id TEXT NOT NULL, -- submission_id for approvals, award_name for grants
    activity_data TEXT, -- JSON data specific to activity type
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_created_at ON activity_feed (created_at DESC);
CREATE INDEX idx_activity_type ON activity_feed (activity_type);
CREATE INDEX idx_activity_member ON activity_feed (member_id);
CREATE INDEX idx_submissions_witness_status ON submissions (witness_verification_status);
CREATE INDEX idx_submissions_witnessed_by ON submissions (witnessed_by);
CREATE INDEX idx_submissions_witness_program ON submissions (
    witness_verification_status,
    program,
    witnessed_on
);
CREATE INDEX idx_submissions_denied_on ON submissions(denied_on);
CREATE INDEX idx_submissions_denied_by ON submissions(denied_by);
CREATE TABLE submission_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL
        REFERENCES submissions(id)
        ON DELETE CASCADE,
    admin_id INTEGER
        REFERENCES members(id)
        ON DELETE SET NULL,
    note_text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_submission_notes_submission ON submission_notes(submission_id, created_at ASC);
CREATE INDEX idx_submission_notes_admin ON submission_notes(admin_id);
CREATE TABLE failed_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    attempted_at DATETIME NOT NULL,
    ip_address TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
CREATE INDEX idx_failed_attempts_member ON failed_login_attempts(member_id, attempted_at);

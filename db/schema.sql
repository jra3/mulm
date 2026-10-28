CREATE TABLE "migrations" (
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
CREATE INDEX idx_google_member_id ON google_account (member_id);
CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	expires_on DATETIME NOT NULL
, oauth_state TEXT DEFAULT NULL, csrf_token TEXT);
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
	canonical_species_name TEXT NOT NULL, species_type TEXT, base_points INTEGER DEFAULT NULL, is_cares_species INTEGER DEFAULT 0, iucn_redlist_category TEXT DEFAULT NULL
  CHECK (iucn_redlist_category IN ('EX', 'EW', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE')), iucn_redlist_id INTEGER DEFAULT NULL, iucn_last_updated DATETIME DEFAULT NULL, iucn_population_trend TEXT DEFAULT NULL
  CHECK (iucn_population_trend IN ('Increasing', 'Decreasing', 'Stable', 'Unknown')), iucn_redlist_url TEXT DEFAULT NULL, last_external_sync TEXT,
	UNIQUE (canonical_genus, canonical_species_name)
);
CREATE INDEX idx_member_contact_email ON members (contact_email);
CREATE INDEX idx_member_display_name ON members (display_name);
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
CREATE TABLE species_common_name (
  common_name_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  common_name TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  UNIQUE (group_id, common_name)
);
CREATE INDEX idx_species_common_name_lookup ON species_common_name(common_name);
CREATE INDEX idx_species_common_name_group ON species_common_name(group_id);
CREATE TABLE species_scientific_name (
  scientific_name_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  scientific_name TEXT NOT NULL, is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0, 1)),
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  UNIQUE (group_id, scientific_name)
);
CREATE INDEX idx_species_scientific_name_lookup ON species_scientific_name(scientific_name);
CREATE INDEX idx_species_scientific_name_group ON species_scientific_name(group_id);
CREATE TABLE "submissions" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Member reference with ON DELETE SET NULL (preserve submissions if member deleted)
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,

  -- Program with CHECK constraint for valid values
  program TEXT NOT NULL CHECK(program IN ('fish', 'plant', 'coral')),

  -- Species identification (text fields always preserved)
  species_type TEXT NOT NULL CHECK(species_type IN ('Fish', 'Plant', 'Invert', 'Coral')),
  species_class TEXT NOT NULL,
  species_common_name TEXT NOT NULL,
  species_latin_name TEXT NOT NULL,

  -- Split schema FKs with ON DELETE SET NULL (preserve submissions if species names deleted)
  water_type TEXT,
  count TEXT,
  reproduction_date TEXT,
  foods TEXT NOT NULL DEFAULT '[]',
  spawn_locations TEXT NOT NULL DEFAULT '[]',
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

  -- Lighting and supplements (for plants/corals)
  light_type TEXT,
  light_strength TEXT,
  light_hours TEXT,
  co2 TEXT,
  co2_description TEXT,
  video_url TEXT,

  -- Submission workflow
  submitted_on DATETIME,
  approved_on DATETIME,
  approved_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  points INTEGER,
  article_points INTEGER,
  first_time_species BOOLEAN,
  flowered BOOLEAN,
  sexual_reproduction BOOLEAN,

  -- Witness/screening workflow with ON DELETE SET NULL
  witnessed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  witnessed_on DATETIME,
  witness_verification_status TEXT CHECK(witness_verification_status IN ('pending', 'confirmed', 'declined')) DEFAULT 'pending',

  -- Denial workflow with ON DELETE SET NULL
  denied_on DATETIME,
  denied_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  denied_reason TEXT
, cares_species BOOLEAN DEFAULT 0, article_link TEXT, changes_requested_on DATETIME DEFAULT NULL, changes_requested_by INTEGER DEFAULT NULL
    REFERENCES members(id) ON DELETE SET NULL, changes_requested_reason TEXT DEFAULT NULL, notes TEXT, final_submission_on DATETIME, final_submission_reminder_sent_on DATETIME, species_id INTEGER REFERENCES species_name_group(group_id) ON DELETE RESTRICT);
CREATE INDEX idx_submissions_member ON submissions(member_id);
CREATE INDEX idx_submissions_approved ON submissions(approved_on);
CREATE INDEX idx_submissions_witness_status ON submissions(witness_verification_status);
CREATE INDEX idx_submissions_witnessed_by ON submissions(witnessed_by);
CREATE INDEX idx_submissions_witness_program ON submissions(
  witness_verification_status,
  program,
  witnessed_on
);
CREATE INDEX idx_submissions_denied_on ON submissions(denied_on);
CREATE INDEX idx_submissions_denied_by ON submissions(denied_by);
CREATE INDEX idx_submissions_changes_requested_on ON submissions(changes_requested_on);
CREATE INDEX idx_submissions_changes_requested_by ON submissions(changes_requested_by);
CREATE TABLE iucn_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  sync_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('success', 'not_found', 'api_error', 'rate_limited', 'csv_import')),
  category_found TEXT,
  error_message TEXT
);
CREATE INDEX idx_iucn_sync_group ON iucn_sync_log (group_id);
CREATE INDEX idx_iucn_sync_date ON iucn_sync_log (sync_date DESC);
CREATE INDEX idx_species_iucn_category ON species_name_group (iucn_redlist_category);
CREATE TABLE iucn_canonical_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  current_canonical_genus TEXT NOT NULL,
  current_canonical_species TEXT NOT NULL,
  suggested_canonical_genus TEXT NOT NULL,
  suggested_canonical_species TEXT NOT NULL,
  iucn_taxon_id INTEGER NOT NULL,
  iucn_url TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  reviewed_by INTEGER, -- member_id of admin who reviewed
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES members(id) ON DELETE SET NULL
);
CREATE INDEX idx_canonical_rec_group ON iucn_canonical_recommendations (group_id);
CREATE INDEX idx_canonical_rec_status ON iucn_canonical_recommendations (status);
CREATE INDEX idx_canonical_rec_created ON iucn_canonical_recommendations (created_at DESC);
CREATE UNIQUE INDEX idx_canonical_rec_unique_pending
  ON iucn_canonical_recommendations (group_id, status)
  WHERE status = 'pending';
CREATE TABLE species_collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,

  -- group_id is now optional - NULL if using free-text names
  group_id INTEGER DEFAULT NULL,

  -- Free-text name fields for non-canonical species
  common_name TEXT DEFAULT NULL,
  scientific_name TEXT DEFAULT NULL,

  acquired_date DATE DEFAULT NULL,
  removed_date DATE DEFAULT NULL,
  notes TEXT,
  images TEXT, -- JSON array of image metadata, max 5 images
  visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key constraints
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE,

  -- Must have either a group_id OR a common_name
  CHECK (group_id IS NOT NULL OR common_name IS NOT NULL),

  -- Ensure unique entry per species per member
  -- For canonical species: unique on (member_id, group_id) when active
  -- For non-canonical: unique on (member_id, common_name, scientific_name) when active
  UNIQUE(member_id, group_id, common_name, scientific_name, removed_date)
);
CREATE INDEX idx_collection_member ON species_collection(member_id);
CREATE INDEX idx_collection_species ON species_collection(group_id);
CREATE INDEX idx_collection_visibility ON species_collection(visibility);
CREATE INDEX idx_collection_removed ON species_collection(removed_date);
CREATE INDEX idx_collection_updated ON species_collection(updated_at);
CREATE INDEX idx_collection_current ON species_collection(member_id, removed_date)
  WHERE removed_date IS NULL;
CREATE INDEX idx_collection_keepers ON species_collection(group_id, visibility, removed_date)
  WHERE removed_date IS NULL AND visibility = 'public' AND group_id IS NOT NULL;
CREATE INDEX idx_collection_common_name ON species_collection(common_name)
  WHERE common_name IS NOT NULL;
CREATE TABLE submission_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL
        REFERENCES submissions(id)
        ON DELETE CASCADE,

    -- Image metadata (previously in JSON as ImageMetadata objects)
    r2_key TEXT NOT NULL,
    public_url TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_at DATETIME NOT NULL,
    content_type TEXT NOT NULL,

    -- Display ordering (preserves array order from JSON)
    display_order INTEGER NOT NULL DEFAULT 0,

    UNIQUE(submission_id, r2_key)
);
CREATE INDEX idx_submission_images_submission ON submission_images(submission_id, display_order);
CREATE TABLE submission_supplements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL
        REFERENCES submissions(id)
        ON DELETE CASCADE,

    -- Supplement info (previously stored as parallel JSON arrays)
    supplement_type TEXT NOT NULL,
    supplement_regimen TEXT NOT NULL,

    -- Display ordering (preserves array order from JSON)
    display_order INTEGER NOT NULL DEFAULT 0,

    UNIQUE(submission_id, supplement_type, supplement_regimen)
);
CREATE INDEX idx_submission_supplements_submission ON submission_supplements(submission_id, display_order);
CREATE INDEX idx_submission_supplements_type ON submission_supplements(supplement_type);
CREATE TABLE species_external_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL
        REFERENCES species_name_group(group_id)
        ON DELETE CASCADE,

    reference_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,

    UNIQUE(group_id, reference_url)
);
CREATE INDEX idx_species_references_group ON species_external_references(group_id, display_order);
CREATE TABLE species_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL
        REFERENCES species_name_group(group_id)
        ON DELETE CASCADE,

    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0, title TEXT, attribution TEXT, license TEXT, source TEXT, original_url TEXT,

    UNIQUE(group_id, image_url)
);
CREATE INDEX idx_species_images_group ON species_images(group_id, display_order);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE external_data_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  source TEXT NOT NULL, -- 'fishbase', 'wikipedia', 'gbif', 'iucn_images'
  sync_date TEXT NOT NULL, -- ISO 8601 timestamp
  status TEXT NOT NULL, -- 'success', 'error', 'not_found', 'skipped'
  links_added INTEGER DEFAULT 0,
  images_added INTEGER DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (group_id) REFERENCES species_name_group(group_id) ON DELETE CASCADE
);
CREATE INDEX idx_external_sync_group ON external_data_sync_log(group_id);
CREATE INDEX idx_external_sync_source ON external_data_sync_log(source);
CREATE INDEX idx_external_sync_date ON external_data_sync_log(sync_date DESC);
CREATE INDEX idx_external_sync_status ON external_data_sync_log(status);
CREATE INDEX idx_species_last_external_sync ON species_name_group(last_external_sync);
CREATE TABLE cares_article (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  species_group_id INTEGER NOT NULL REFERENCES species_name_group(group_id),
  title TEXT NOT NULL,
  url TEXT,
  published_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE cares_fry_share (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  species_group_id INTEGER NOT NULL REFERENCES species_name_group(group_id),
  recipient_name TEXT NOT NULL,
  recipient_member_id INTEGER REFERENCES members(id),
  recipient_club TEXT,
  share_date DATE NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cares_article_member ON cares_article(member_id);
CREATE INDEX idx_cares_fry_share_member ON cares_fry_share(member_id, share_date);
CREATE TABLE "activity_feed" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT NOT NULL
        CHECK (activity_type IN ('submission_approved', 'award_granted', 'level_up')),
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,
    related_id TEXT NOT NULL, -- submission_id for approvals, award_name for grants, program for levels
    activity_data TEXT, -- JSON data specific to activity type
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_created_at ON activity_feed (created_at DESC);
CREATE INDEX idx_activity_type ON activity_feed (activity_type);
CREATE INDEX idx_activity_member ON activity_feed (member_id);
CREATE UNIQUE INDEX idx_activity_subject ON activity_feed (activity_type, member_id, related_id);
CREATE UNIQUE INDEX idx_species_scientific_name_canonical
  ON species_scientific_name (group_id) WHERE is_canonical = 1;
CREATE INDEX idx_submissions_species ON submissions(species_id);
CREATE UNIQUE INDEX idx_species_name_group_canonical_nocase
  ON species_name_group (canonical_genus COLLATE NOCASE, canonical_species_name COLLATE NOCASE);
CREATE UNIQUE INDEX idx_members_contact_email_nocase ON members (contact_email COLLATE NOCASE);
CREATE TABLE apple_account (
	apple_sub TEXT PRIMARY KEY,
	apple_email TEXT,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	UNIQUE(member_id)
);
CREATE INDEX idx_apple_member_id ON apple_account (member_id);
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
CREATE TABLE admin_api_tokens (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_admin_api_tokens_member ON admin_api_tokens(member_id);

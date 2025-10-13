-- Up

-- Fix FK constraints on submissions table to use ON DELETE SET NULL
-- This allows force-deleting species while preserving historical submission records

-- SQLite doesn't support ALTER TABLE MODIFY CONSTRAINT, so we need to recreate the table

-- Step 1: Create new table with proper FK constraints
CREATE TABLE submissions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  member_id INTEGER NOT NULL REFERENCES members(id),
  program TEXT CHECK(program IN ('fish', 'plant', 'coral')),

  species_type TEXT NOT NULL CHECK(species_type IN ('Fish', 'Plant', 'Invert', 'Coral')),
  species_class TEXT NOT NULL,
  species_common_name TEXT NOT NULL,
  species_latin_name TEXT NOT NULL,

  -- Fixed: Added ON DELETE SET NULL to preserve submissions when species names deleted
  common_name_id INTEGER REFERENCES species_common_name(common_name_id) ON DELETE SET NULL,
  scientific_name_id INTEGER REFERENCES species_scientific_name(scientific_name_id) ON DELETE SET NULL,

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
  light_type TEXT,
  light_strength TEXT,
  light_hours TEXT,
  co2 TEXT,
  co2_description TEXT,
  supplement_type TEXT NOT NULL DEFAULT '[]',
  supplement_regimen TEXT NOT NULL DEFAULT '[]',

  images TEXT,
  video_url TEXT,

  submitted_on DATETIME,
  approved_on DATETIME,
  approved_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  points INTEGER,
  article_points INTEGER,
  first_time_species BOOLEAN,
  flowered BOOLEAN,
  sexual_reproduction BOOLEAN,

  witnessed_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  witnessed_on DATETIME,
  witness_verification_status TEXT CHECK(witness_verification_status IN ('pending', 'confirmed', 'declined')) DEFAULT 'pending',

  denied_on DATETIME,
  denied_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
  denied_reason TEXT
);

-- Step 2: Copy all data
INSERT INTO submissions_new SELECT * FROM submissions;

-- Step 3: Drop old table
DROP TABLE submissions;

-- Step 4: Rename new table
ALTER TABLE submissions_new RENAME TO submissions;

-- Step 5: Recreate indexes
CREATE INDEX idx_submissions_member ON submissions(member_id);
CREATE INDEX idx_submissions_approved ON submissions(approved_on);
CREATE INDEX idx_submissions_common_name ON submissions(common_name_id);
CREATE INDEX idx_submissions_scientific_name ON submissions(scientific_name_id);
CREATE INDEX idx_submissions_witness_status ON submissions(witness_verification_status);
CREATE INDEX idx_submissions_witnessed_by ON submissions(witnessed_by);
CREATE INDEX idx_submissions_witness_program ON submissions(
  witness_verification_status,
  program,
  witnessed_on
);
CREATE INDEX idx_submissions_denied_on ON submissions(denied_on);
CREATE INDEX idx_submissions_denied_by ON submissions(denied_by);

-- Down

-- Reverting requires recreating table without ON DELETE SET NULL
-- In practice, would need to restore from backup
-- This migration improves data safety, no reason to revert

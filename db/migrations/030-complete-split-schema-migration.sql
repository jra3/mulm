-- Up

-- Complete split schema migration by:
-- 1. Dropping legacy species_name table and species_name_id column
-- 2. Adding proper ON DELETE SET NULL constraints to all FKs
-- 3. Normalizing program values and adding CHECK constraint

-- BREAKING CHANGE: This migration recreates the submissions table.
-- All data is preserved but the table structure changes significantly.

-- Prerequisites:
-- - Migration 029 must have completed successfully
-- - All submissions must have common_name_id and scientific_name_id populated

-- NOTE: FK checks must be disabled during this migration.
-- The sqlite.js library will handle this automatically within the transaction.

-- Step 1: Drop the legacy species_name table (no longer needed)
DROP TABLE IF EXISTS species_name;
DROP INDEX IF EXISTS idx_submissions_species_name;

-- Step 2: Normalize legacy program values before adding CHECK constraint
-- (In case any submissions have old BAP/HAP/CAP values)
UPDATE submissions SET program = LOWER(program);
UPDATE submissions SET program = 'fish' WHERE program IN ('bap', 'fish');
UPDATE submissions SET program = 'plant' WHERE program IN ('hap', 'plant');
UPDATE submissions SET program = 'coral' WHERE program IN ('cap', 'coral');

-- Step 3: Create new submissions table with proper constraints
CREATE TABLE submissions_new (
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
  common_name_id INTEGER REFERENCES species_common_name(common_name_id) ON DELETE SET NULL,
  scientific_name_id INTEGER REFERENCES species_scientific_name(scientific_name_id) ON DELETE SET NULL,

  -- Tank parameters
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
  supplement_type TEXT NOT NULL DEFAULT '[]',
  supplement_regimen TEXT NOT NULL DEFAULT '[]',

  -- Media
  images TEXT,
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
);

-- Step 4: Copy all data (note: species_name_id column is not copied to new schema)
-- Use COALESCE to handle NULL values in columns that are now NOT NULL
INSERT INTO submissions_new
SELECT
  id, created_on, updated_on, member_id, program,
  species_type, species_class, species_common_name, species_latin_name,
  common_name_id, scientific_name_id,
  water_type, count, reproduction_date,
  COALESCE(foods, '[]'), COALESCE(spawn_locations, '[]'), propagation_method,
  tank_size, filter_type, water_change_volume, water_change_frequency,
  temperature, ph, gh, specific_gravity,
  substrate_type, substrate_depth, substrate_color,
  light_type, light_strength, light_hours,
  co2, co2_description,
  COALESCE(supplement_type, '[]'), COALESCE(supplement_regimen, '[]'),
  images, video_url,
  submitted_on, approved_on, approved_by, points, article_points,
  first_time_species, flowered, sexual_reproduction,
  witnessed_by, witnessed_on, witness_verification_status,
  denied_on, denied_by, denied_reason
FROM submissions;

-- Step 5: Drop old table and rename new one
DROP TABLE submissions;
ALTER TABLE submissions_new RENAME TO submissions;

-- Step 6: Recreate all indexes
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
CREATE INDEX IF NOT EXISTS idx_submissions_member ON submissions(member_id);
CREATE INDEX IF NOT EXISTS idx_submissions_approved ON submissions(approved_on);
CREATE INDEX IF NOT EXISTS idx_submissions_common_name ON submissions(common_name_id);
CREATE INDEX IF NOT EXISTS idx_submissions_scientific_name ON submissions(scientific_name_id);
CREATE INDEX IF NOT EXISTS idx_submissions_witness_status ON submissions(witness_verification_status);
CREATE INDEX IF NOT EXISTS idx_submissions_witnessed_by ON submissions(witnessed_by);
CREATE INDEX IF NOT EXISTS idx_submissions_witness_program ON submissions(
  witness_verification_status,
  program,
  witnessed_on
);
CREATE INDEX IF NOT EXISTS idx_submissions_denied_on ON submissions(denied_on);
CREATE INDEX IF NOT EXISTS idx_submissions_denied_by ON submissions(denied_by);

-- Down

-- Reverting this migration is complex and would require:
-- 1. Recreating species_name table from split tables
-- 2. Restoring species_name_id column and values
-- 3. Removing ON DELETE SET NULL constraints
-- 4. Removing program CHECK constraint
-- In practice, restore from backup taken before this migration.

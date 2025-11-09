-- Up

-- ============================================================================
-- PHASE 1: Create new normalized tables for JSON fields
-- ============================================================================

-- 1. submission_images table (replaces submissions.images JSON field)
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

-- 2. submission_supplements table (replaces supplement_type/regimen parallel arrays)
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

-- 3. species_external_references table (replaces species_name_group.external_references)
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

-- 4. species_images table (replaces species_name_group.image_links)
CREATE TABLE species_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL
        REFERENCES species_name_group(group_id)
        ON DELETE CASCADE,

    image_url TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,

    UNIQUE(group_id, image_url)
);

CREATE INDEX idx_species_images_group ON species_images(group_id, display_order);

-- ============================================================================
-- PHASE 2: Migrate existing JSON data to new tables
-- ============================================================================

-- Note: SQLite doesn't have a native JSON_TABLE function, so we need to handle
-- migration in application code or use a migration script.
-- See: scripts/migrate-json-to-relational.ts

-- ============================================================================
-- PHASE 3: Remove old JSON columns (after data migration verified)
-- ============================================================================

-- These will be uncommented after migration is verified successful:
-- ALTER TABLE submissions DROP COLUMN images;
-- ALTER TABLE submissions DROP COLUMN supplement_type;
-- ALTER TABLE submissions DROP COLUMN supplement_regimen;
-- ALTER TABLE species_name_group DROP COLUMN external_references;
-- ALTER TABLE species_name_group DROP COLUMN image_links;

-- Down

-- Restore old columns
ALTER TABLE submissions ADD COLUMN images TEXT DEFAULT NULL;
ALTER TABLE submissions ADD COLUMN supplement_type TEXT;
ALTER TABLE submissions ADD COLUMN supplement_regimen TEXT;
ALTER TABLE species_name_group ADD COLUMN external_references TEXT DEFAULT NULL;
ALTER TABLE species_name_group ADD COLUMN image_links TEXT DEFAULT NULL;

-- Drop new tables
DROP INDEX IF EXISTS idx_species_images_group;
DROP TABLE IF EXISTS species_images;

DROP INDEX IF EXISTS idx_species_references_group;
DROP TABLE IF EXISTS species_external_references;

DROP INDEX IF EXISTS idx_submission_supplements_type;
DROP INDEX IF EXISTS idx_submission_supplements_submission;
DROP TABLE IF EXISTS submission_supplements;

DROP INDEX IF EXISTS idx_submission_images_submission;
DROP TABLE IF EXISTS submission_images;

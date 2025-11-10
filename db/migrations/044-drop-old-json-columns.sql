-- Drop old JSON columns after migration to normalized tables
-- This migration completes Phase 3 of the normalization process started in migration 043

-- ============================================================================
-- PHASE 3: Remove old JSON columns (data already migrated to normalized tables)
-- ============================================================================

-- Drop submissions JSON columns
-- Data migrated to submission_images and submission_supplements tables
ALTER TABLE submissions DROP COLUMN images;
ALTER TABLE submissions DROP COLUMN supplement_type;
ALTER TABLE submissions DROP COLUMN supplement_regimen;

-- Drop species_name_group JSON columns
-- Data migrated to species_external_references and species_images tables
ALTER TABLE species_name_group DROP COLUMN external_references;
ALTER TABLE species_name_group DROP COLUMN image_links;

-- Down

-- Restore old columns (data will be lost - use migration 043 down to restore properly)
ALTER TABLE submissions ADD COLUMN images TEXT DEFAULT NULL;
ALTER TABLE submissions ADD COLUMN supplement_type TEXT;
ALTER TABLE submissions ADD COLUMN supplement_regimen TEXT;
ALTER TABLE species_name_group ADD COLUMN external_references TEXT DEFAULT NULL;
ALTER TABLE species_name_group ADD COLUMN image_links TEXT DEFAULT NULL;

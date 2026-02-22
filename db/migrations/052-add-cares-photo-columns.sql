-- Add CARES photo storage columns to species_collection
-- The cares_photo_id column from migration 050 references a non-existent uploads table.
-- These columns store the R2 key and public URL directly, matching existing image patterns.

ALTER TABLE species_collection ADD COLUMN cares_photo_key TEXT;
ALTER TABLE species_collection ADD COLUMN cares_photo_url TEXT;

-- Up

-- Add base points for each species (varies by rarity/difficulty)
-- Points awarded when this species is successfully bred
ALTER TABLE species_name_group ADD COLUMN base_points INTEGER DEFAULT NULL;

-- Add external references (JSON array of reference URLs)
-- Example: ["https://fishbase.org/summary/1234", "https://seriouslyfish.com/species/..."]
-- Stored as JSON text, parsed by application
ALTER TABLE species_name_group ADD COLUMN external_references TEXT DEFAULT NULL;

-- Add image links (JSON array of image URLs)
-- Example: ["https://example.com/species1.jpg", "https://example.com/species2.jpg"]
-- Can reference public image databases or uploaded images
ALTER TABLE species_name_group ADD COLUMN image_links TEXT DEFAULT NULL;

-- Add CARES conservation status
-- 1 = Species is in CARES program (conservation priority)
-- 0 = Not a CARES species
-- CARES = Conservation, Awareness, Recognition, Encouragement, Support
ALTER TABLE species_name_group ADD COLUMN is_cares_species INTEGER DEFAULT 0;

-- Down
-- SQLite doesn't support DROP COLUMN
-- Columns will remain if migration is rolled back
-- This is acceptable as they default to NULL/0 and won't break existing functionality

-- Migration 049: Add metadata fields to species_images
-- Stores attribution, title, license, and source information for proper crediting

ALTER TABLE species_images ADD COLUMN title TEXT;
ALTER TABLE species_images ADD COLUMN attribution TEXT;
ALTER TABLE species_images ADD COLUMN license TEXT;
ALTER TABLE species_images ADD COLUMN source TEXT; -- e.g., 'fishbase', 'wikipedia', 'gbif', 'user_upload'
ALTER TABLE species_images ADD COLUMN original_url TEXT; -- Original URL before R2 upload

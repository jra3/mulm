-- Migration: Add IUCN Red List URL field
-- Stores the direct URL to IUCN species page (includes both sis_id and assessment_id)
-- Related to Issue #179: Fix broken IUCN links

-- Up
--------------------------------------------------------------------------------

-- Add URL field to store the complete IUCN Red List species page URL
ALTER TABLE species_name_group ADD COLUMN iucn_redlist_url TEXT DEFAULT NULL;

-- Down
--------------------------------------------------------------------------------
-- Note: SQLite does not support DROP COLUMN
-- This is a one-way migration

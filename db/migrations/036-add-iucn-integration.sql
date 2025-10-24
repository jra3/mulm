-- Migration: Add IUCN Red List integration support
-- This adds fields to track IUCN conservation status and sync history
-- Related to Issue #179: Integrate with IUCN Red List API

-- Up
--------------------------------------------------------------------------------

-- Add IUCN fields to species_name_group table
ALTER TABLE species_name_group ADD COLUMN iucn_redlist_category TEXT DEFAULT NULL
  CHECK (iucn_redlist_category IN ('EX', 'EW', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE'));

ALTER TABLE species_name_group ADD COLUMN iucn_redlist_id INTEGER DEFAULT NULL;

ALTER TABLE species_name_group ADD COLUMN iucn_last_updated DATETIME DEFAULT NULL;

ALTER TABLE species_name_group ADD COLUMN iucn_population_trend TEXT DEFAULT NULL
  CHECK (iucn_population_trend IN ('Increasing', 'Decreasing', 'Stable', 'Unknown'));

-- Create audit/sync tracking table
CREATE TABLE iucn_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES species_name_group(group_id) ON DELETE CASCADE,
  sync_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('success', 'not_found', 'api_error', 'rate_limited', 'csv_import')),
  category_found TEXT,
  error_message TEXT
);

-- Create indexes for efficient querying
CREATE INDEX idx_iucn_sync_group ON iucn_sync_log (group_id);
CREATE INDEX idx_iucn_sync_date ON iucn_sync_log (sync_date DESC);
CREATE INDEX idx_species_iucn_category ON species_name_group (iucn_redlist_category);

-- Down
--------------------------------------------------------------------------------
-- Note: SQLite does not support DROP COLUMN, so rollback requires manual intervention.
-- To rollback this migration:
-- 1. Drop the iucn_sync_log table:
--    DROP TABLE IF EXISTS iucn_sync_log;
-- 2. Create a new species_name_group table without IUCN columns and copy data
-- 3. Drop the old table and rename the new one
--
-- Automated rollback not provided due to SQLite limitations.
-- This is a one-way migration. Plan accordingly before applying to production.

-- DROP TABLE IF EXISTS iucn_sync_log;

-- Migration 048: Add external data sync logging
-- Tracks sync operations for external species data (FishBase, Wikipedia, GBIF, IUCN images)

-- External data sync log table
CREATE TABLE IF NOT EXISTS external_data_sync_log (
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

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_external_sync_group ON external_data_sync_log(group_id);
CREATE INDEX IF NOT EXISTS idx_external_sync_source ON external_data_sync_log(source);
CREATE INDEX IF NOT EXISTS idx_external_sync_date ON external_data_sync_log(sync_date DESC);
CREATE INDEX IF NOT EXISTS idx_external_sync_status ON external_data_sync_log(status);

-- Add last external sync timestamp to species table
ALTER TABLE species_name_group ADD COLUMN last_external_sync TEXT;

-- Create index for finding species needing sync
CREATE INDEX IF NOT EXISTS idx_species_last_external_sync ON species_name_group(last_external_sync);

-- Up

-- Add new foreign key columns to submissions for the split name tables
-- These are nullable during migration, will be populated in next migration
ALTER TABLE submissions ADD COLUMN common_name_id INTEGER REFERENCES species_common_name(common_name_id);
ALTER TABLE submissions ADD COLUMN scientific_name_id INTEGER REFERENCES species_scientific_name(scientific_name_id);

-- Create indexes for the new foreign keys
CREATE INDEX idx_submissions_common_name ON submissions(common_name_id);
CREATE INDEX idx_submissions_scientific_name ON submissions(scientific_name_id);

-- Down

-- Remove indexes
DROP INDEX IF EXISTS idx_submissions_scientific_name;
DROP INDEX IF EXISTS idx_submissions_common_name;

-- SQLite doesn't support DROP COLUMN in older versions
-- In production, would need to recreate table without these columns
-- For now, document that rollback requires manual intervention

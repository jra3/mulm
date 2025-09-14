-- Add fields to track submission denials
ALTER TABLE submissions ADD COLUMN denied_on DATETIME DEFAULT NULL;
ALTER TABLE submissions ADD COLUMN denied_by INTEGER DEFAULT NULL REFERENCES members(id) ON DELETE RESTRICT;
ALTER TABLE submissions ADD COLUMN denied_reason TEXT DEFAULT NULL;

-- Add indexes for efficient querying
CREATE INDEX idx_submissions_denied_on ON submissions(denied_on);
CREATE INDEX idx_submissions_denied_by ON submissions(denied_by);

-- Add check constraint to ensure denial fields are set together
-- (if denied_on is set, denied_by must also be set)
-- Note: SQLite doesn't support adding CHECK constraints to existing tables,
-- so this is more for documentation of the business rule
-- Add fields to track when admin requests changes to a submission
-- This allows submissions to be returned to users for edits while preserving witness data

-- Add timestamp for when changes were requested
ALTER TABLE submissions ADD COLUMN changes_requested_on DATETIME DEFAULT NULL;

-- Track which admin requested the changes
ALTER TABLE submissions ADD COLUMN changes_requested_by INTEGER DEFAULT NULL
    REFERENCES members(id) ON DELETE SET NULL;

-- Store the admin's feedback/reason for requesting changes
ALTER TABLE submissions ADD COLUMN changes_requested_reason TEXT DEFAULT NULL;

-- Add indexes for efficient querying
CREATE INDEX idx_submissions_changes_requested_on ON submissions(changes_requested_on);
CREATE INDEX idx_submissions_changes_requested_by ON submissions(changes_requested_by);

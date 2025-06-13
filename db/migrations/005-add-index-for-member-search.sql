-- Up
-- Add index on display_name for member search functionality
CREATE INDEX idx_member_display_name ON members (display_name);

-- Down
DROP INDEX IF EXISTS idx_member_display_name;
-- DROP INDEX IF EXISTS idx_member_display_name_lower;

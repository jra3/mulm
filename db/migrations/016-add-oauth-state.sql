-- Up
ALTER TABLE sessions ADD COLUMN oauth_state TEXT DEFAULT NULL;

-- Down
-- SQLite doesn't support DROP COLUMN, so we'd need to recreate table
-- For now, column can remain (won't affect existing functionality)

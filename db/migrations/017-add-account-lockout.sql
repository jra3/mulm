-- Up

-- Add locked_until column to members table
ALTER TABLE members ADD COLUMN locked_until DATETIME DEFAULT NULL;

-- Create failed login attempts tracking table
CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    attempted_at DATETIME NOT NULL,
    ip_address TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

-- Index for efficient lookups of recent attempts
CREATE INDEX idx_failed_attempts_member ON failed_login_attempts(member_id, attempted_at);

-- Down

-- SQLite doesn't support DROP COLUMN, so we'd need to recreate table
-- For now, columns can remain (won't affect existing functionality)
DROP TABLE IF EXISTS failed_login_attempts;

-- Up

-- Add facebook_account table for Facebook OAuth login
-- Mirrors google_account table structure
CREATE TABLE facebook_account (
	facebook_id TEXT PRIMARY KEY,
	facebook_email TEXT,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	UNIQUE(member_id)
);

-- Index for faster lookups by member_id
CREATE INDEX idx_facebook_member_id ON facebook_account (member_id);

-- Down

DROP INDEX idx_facebook_member_id;
DROP TABLE facebook_account;

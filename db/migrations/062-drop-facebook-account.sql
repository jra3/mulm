-- Up

-- Facebook login is gone (#442). No member ever linked a Facebook account, so
-- nothing is lost.
DROP INDEX IF EXISTS idx_facebook_member_id;
DROP TABLE facebook_account;

-- Down

CREATE TABLE facebook_account (
	facebook_id TEXT PRIMARY KEY,
	facebook_email TEXT,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	UNIQUE(member_id)
);
CREATE INDEX idx_facebook_member_id ON facebook_account (member_id);

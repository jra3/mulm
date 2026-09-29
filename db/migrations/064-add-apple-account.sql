-- Up

-- Sign in with Apple (#442). Mirrors google_account: Apple's stable `sub`
-- keyed to one member.
CREATE TABLE apple_account (
	apple_sub TEXT PRIMARY KEY,
	apple_email TEXT,
	member_id INTEGER
		REFERENCES members(id)
		ON DELETE CASCADE
		NOT NULL,
	UNIQUE(member_id)
);
CREATE INDEX idx_apple_member_id ON apple_account (member_id);

-- Down

DROP INDEX idx_apple_member_id;
DROP TABLE apple_account;

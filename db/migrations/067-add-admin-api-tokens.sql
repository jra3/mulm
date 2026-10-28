-- Up

-- An admin API token lets a script act as one admin on /api/admin (#595).
-- Only the SHA-256 of the token is kept; the token itself is shown once, at
-- mint. Times are ISO-8601 strings written by the app, like sessions.expires_on.
-- A token is never deleted, only revoked, so its row stays as a record of who
-- held it.
CREATE TABLE admin_api_tokens (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX idx_admin_api_tokens_member ON admin_api_tokens(member_id);

-- Down

DROP INDEX idx_admin_api_tokens_member;
DROP TABLE admin_api_tokens;

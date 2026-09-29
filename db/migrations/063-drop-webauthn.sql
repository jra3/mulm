-- Up

-- Passkey login is gone (#442). The one member who registered passkeys also
-- has a password and a Google link, so nobody is locked out.
DROP INDEX IF EXISTS idx_webauthn_challenges_expires;
DROP TABLE webauthn_challenges;
DROP INDEX IF EXISTS idx_webauthn_member_id;
DROP INDEX IF EXISTS idx_webauthn_credential_id;
DROP TABLE webauthn_credentials;

-- Down

-- The tables come back empty; registered credentials are not recoverable.
CREATE TABLE webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_name TEXT,
    created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_on DATETIME,
    authenticator_attachment TEXT
);
CREATE INDEX idx_webauthn_member_id ON webauthn_credentials (member_id);
CREATE INDEX idx_webauthn_credential_id ON webauthn_credentials (credential_id);
CREATE TABLE webauthn_challenges (
    challenge TEXT PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('registration', 'authentication')),
    expires_on DATETIME NOT NULL,
    created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges (expires_on);

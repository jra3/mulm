-- Up

-- Add Passkey (WebAuthn) authentication support
-- Provides passwordless, phishing-resistant authentication

-- Store registered passkey credentials for members
CREATE TABLE webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Link to member account
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,

    -- WebAuthn credential data
    credential_id TEXT NOT NULL UNIQUE, -- Base64URL-encoded credential ID
    public_key BLOB NOT NULL,          -- Public key for signature verification
    counter INTEGER NOT NULL DEFAULT 0, -- Signature counter for replay protection

    -- Authenticator info
    transports TEXT,                   -- JSON array: ["internal", "usb", "nfc", "ble"]
    device_name TEXT,                  -- User-friendly name ("iPhone", "YubiKey")

    -- Timestamps
    created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_on DATETIME
);

CREATE INDEX idx_webauthn_member_id ON webauthn_credentials (member_id);
CREATE INDEX idx_webauthn_credential_id ON webauthn_credentials (credential_id);

-- Temporary challenge storage for registration/authentication flows
-- Challenges are single-use and short-lived (5 minutes)
CREATE TABLE webauthn_challenges (
    challenge TEXT PRIMARY KEY,        -- Base64URL-encoded random challenge
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE, -- NULL for login, present for registration
    purpose TEXT NOT NULL CHECK(purpose IN ('registration', 'authentication')),
    expires_on DATETIME NOT NULL,
    created_on DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges (expires_on);

-- Down

DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS webauthn_credentials;

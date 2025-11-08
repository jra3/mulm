-- Up

-- Add authenticator_attachment column to track passkey type
-- Values: 'platform' (Touch ID, Face ID, Windows Hello) or 'cross-platform' (security keys)
ALTER TABLE webauthn_credentials ADD COLUMN authenticator_attachment TEXT;

-- Down

ALTER TABLE webauthn_credentials DROP COLUMN authenticator_attachment;

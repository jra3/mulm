-- Up
CREATE INDEX idx_member_contact_email ON members (contact_email);

-- Down
DROP INDEX IF EXISTS idx_member_contact_email;

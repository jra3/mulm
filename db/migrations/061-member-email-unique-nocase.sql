-- Up

-- An email address is one address whatever its case. The UNIQUE from 001
-- compares with BINARY, and nothing normalises an address on the way in, so
-- a member who signed up as "Jane@example.com" was not found as
-- "jane@example.com" at login or password reset, and a first Google or
-- Facebook login created a second account for them. Addresses stay stored as
-- typed; lookups compare with NOCASE (getMemberByEmail) and this index keeps
-- two members from holding the same address.
--
-- If two members already share an address up to case, building this index
-- fails with a UNIQUE constraint error and the migration does not run. Merge
-- them first (scripts/merge-members.ts). To list them:
--   SELECT LOWER(contact_email), GROUP_CONCAT(id) FROM members
--   GROUP BY 1 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX idx_members_contact_email_nocase ON members (contact_email COLLATE NOCASE);

-- Down

DROP INDEX IF EXISTS idx_members_contact_email_nocase;

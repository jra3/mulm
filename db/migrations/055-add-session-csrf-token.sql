-- Up

-- Issue #19 Phase 2: defense-in-depth synchronizer CSRF token.
--
-- Each session carries a high-entropy CSRF token. The server surfaces it into
-- authenticated pages via a <meta> tag; the browser echoes it back on every
-- state-changing request (X-CSRF-Token header / _csrf field) where it is
-- compared against this stored value. This backs up the Phase 1 Origin/Referer
-- check, closing the sibling-subdomain SameSite carve-out with a second,
-- independent control.

ALTER TABLE sessions ADD COLUMN csrf_token TEXT;

-- Backfill existing sessions so logged-in users aren't forced to re-auth on
-- deploy. randomblob(32) -> 64 hex chars, matching newly-issued tokens.
UPDATE sessions
SET csrf_token = lower(hex(randomblob(32)))
WHERE csrf_token IS NULL;

-- Down

-- SQLite can't DROP COLUMN cleanly on older versions; leaving the column is
-- harmless if rolled back.

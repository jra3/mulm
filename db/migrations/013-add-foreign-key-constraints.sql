-- ================================================================================
-- Migration: 013-enable-foreign-key-constraints.sql
-- Description: Enable foreign key constraint enforcement for data integrity
-- ================================================================================

-- UP

-- Clean up any remaining foreign key violations before enabling enforcement
-- Fix orphaned member_id references  
UPDATE submissions SET member_id = NULL WHERE member_id NOT IN (SELECT id FROM members);

-- Clean up any remaining orphaned references (should be handled by earlier migrations)
UPDATE submissions SET approved_by = NULL WHERE approved_by IS NOT NULL AND approved_by NOT IN (SELECT id FROM members);
UPDATE submissions SET witnessed_by = NULL WHERE witnessed_by IS NOT NULL AND witnessed_by NOT IN (SELECT id FROM members);

-- Foreign key constraint enforcement is now enabled in the database initialization
-- code (src/db/conn.ts). This migration serves as a marker that foreign keys are
-- now enforced.

-- The existing foreign key references will now be enforced:
-- - submissions.witnessed_by -> members.id
-- - submissions.member_id -> members.id (if defined)

-- Enable foreign key constraints for this migration to verify cleanup worked
PRAGMA foreign_keys = ON;

-- Verify that all existing data now complies with foreign key constraints
PRAGMA foreign_key_check;

-- ================================================================================
-- DOWN
-- ================================================================================

-- Foreign key enforcement would be disabled by removing PRAGMA foreign_keys = ON
-- from the database initialization code.
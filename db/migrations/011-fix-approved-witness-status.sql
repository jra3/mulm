-- ================================================================================
-- Migration: 011-fix-approved-witness-status.sql
-- Description: Fix witness status for already approved submissions
-- 
-- The previous migration incorrectly set witness_verification_status = 'confirmed'
-- for all submitted records, including those already approved. Already approved
-- submissions should not need witness verification since they're complete.
-- 
-- This migration sets already approved submissions back to 'pending' to remove
-- them from the waiting period queue. They won't appear in witness queue either
-- since they have approved_on set.
-- ================================================================================

-- UP
-- For already approved submissions, we can either:
-- Option 1: Set them back to 'pending' (they won't show in any queue since approved)
-- Option 2: Set witnessed_by to approved_by and witnessed_on to approved_on
-- We'll use Option 2 to maintain data consistency

UPDATE submissions 
SET witnessed_by = approved_by,
    witnessed_on = approved_on
WHERE approved_on IS NOT NULL 
  AND witnessed_by IS NULL
  AND witness_verification_status = 'confirmed';

-- ================================================================================
-- DOWN
-- ================================================================================
UPDATE submissions 
SET witnessed_by = NULL,
    witnessed_on = NULL
WHERE approved_on IS NOT NULL 
  AND witnessed_by = approved_by
  AND witnessed_on = approved_on;
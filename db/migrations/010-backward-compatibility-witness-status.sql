-- ================================================================================
-- Migration: 010-backward-compatibility-witness-status.sql
-- Description: Update existing submitted records to have appropriate witness status
-- 
-- For submissions that were submitted before the witness system was implemented,
-- we need to set their witness status appropriately:
-- - Submitted records should be marked as 'confirmed' (already witnessed under old system)
-- - Already approved records should remain 'confirmed' 
-- - Draft records (not submitted) should remain 'pending'
-- ================================================================================

-- UP
-- Set existing submitted records to 'confirmed' status since they were 
-- submitted under the old system and should be treated as already witnessed
UPDATE submissions 
SET witness_verification_status = 'confirmed'
WHERE submitted_on IS NOT NULL 
  AND witness_verification_status = 'pending';

-- For already approved submissions, ensure they have confirmed witness status
UPDATE submissions 
SET witness_verification_status = 'confirmed'
WHERE approved_on IS NOT NULL 
  AND witness_verification_status = 'pending';

-- ================================================================================
-- DOWN
-- ================================================================================
UPDATE submissions 
SET witness_verification_status = 'pending'
WHERE witness_verification_status = 'confirmed' 
  AND witnessed_by IS NULL 
  AND witnessed_on IS NULL;
-- Add final_submission_on column to track when the submitter (or an admin)
-- confirms the fish/plant/coral was brought to a monthly meeting and is
-- ready to enter the admin approval queue.
--
-- After the waiting period elapses, a submission no longer auto-promotes
-- into the approval queue. Instead the submitter must click a button that
-- sets this column. The approval queue query requires this column to be
-- non-null.
--
-- Backfill: any already-approved submission counts as final-submitted at
-- the moment it was approved, so historical data still shows up correctly
-- and the existing approval queue isn't disrupted for in-flight items.

ALTER TABLE submissions ADD COLUMN final_submission_on DATETIME;

UPDATE submissions
SET final_submission_on = approved_on
WHERE approved_on IS NOT NULL;

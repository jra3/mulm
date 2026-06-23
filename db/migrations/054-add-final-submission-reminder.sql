-- Track when the "waiting period complete — ready for final submission" reminder
-- was emailed to the submitter, so the daily reminder job sends it at most once
-- per submission. NULL = not yet reminded.
--
-- Companion to migration 053 (final_submission_on): after the waiting period
-- elapses a submission sits in the awaiting-final-submission state until the
-- submitter acts, and this column gates the nudge email that prompts them.

ALTER TABLE submissions ADD COLUMN final_submission_reminder_sent_on DATETIME;

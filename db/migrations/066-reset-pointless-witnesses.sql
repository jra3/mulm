-- Up

-- Points are set at the Witness (ADR-0003, #524). A Submission witnessed
-- under the old flow is confirmed but carries no points, and there is no
-- legacy approval path for it, so it goes back to awaiting a Witness and is
-- re-witnessed on the new panel. No fresh sighting is needed: the original
-- witness saw the fry, and the changelog note below says who and when, so
-- the re-witnesser knows. The clock counts from reproduction_date, so nothing
-- restarts.
--
-- The note first, while witnessed_by and witnessed_on are still there to read.
-- It is attributed to the original witness; one who is no longer a member is
-- named as such and attributed to nobody, since admin_id must point at a row.
INSERT INTO submission_notes (submission_id, admin_id, note_text)
SELECT s.id,
       m.id,
       'Witness reset when points moved to the Witness; originally witnessed by '
         || COALESCE(m.display_name, 'a former committee member')
         || ' on '
         || COALESCE(date(s.witnessed_on), substr(s.witnessed_on, 1, 10))
FROM submissions s
LEFT JOIN members m ON m.id = s.witnessed_by
WHERE s.witness_verification_status = 'confirmed'
  AND s.approved_on IS NULL
  AND s.points IS NULL;

-- Then the reset itself, clearing what a voided Witness clears (voidWitness,
-- src/lifecycle/transitions.ts) and the dead final_submission_on with it.
UPDATE submissions
SET witness_verification_status = 'pending',
    witnessed_by = NULL,
    witnessed_on = NULL,
    final_submission_on = NULL,
    points = NULL,
    article_points = NULL,
    cares_species = NULL,
    flowered = NULL,
    sexual_reproduction = NULL
WHERE witness_verification_status = 'confirmed'
  AND approved_on IS NULL
  AND points IS NULL;

-- Down

-- The Witness comes back from its note, to the day (the time of day is lost),
-- on rows nobody has re-witnessed or approved since. A note attributed to
-- nobody cannot name a witness, so that row stays awaiting one. The notes go
-- with the reset either way.
UPDATE submissions
SET witness_verification_status = 'confirmed',
    witnessed_by = (
      SELECT n.admin_id FROM submission_notes n
      WHERE n.submission_id = submissions.id
        AND n.note_text LIKE 'Witness reset when points moved to the Witness; originally witnessed by %'
      ORDER BY n.id DESC LIMIT 1
    ),
    witnessed_on = (
      SELECT substr(n.note_text, -10) FROM submission_notes n
      WHERE n.submission_id = submissions.id
        AND n.note_text LIKE 'Witness reset when points moved to the Witness; originally witnessed by %'
      ORDER BY n.id DESC LIMIT 1
    )
WHERE witness_verification_status = 'pending'
  AND approved_on IS NULL
  AND EXISTS (
    SELECT 1 FROM submission_notes n
    WHERE n.submission_id = submissions.id
      AND n.admin_id IS NOT NULL
      AND n.note_text LIKE 'Witness reset when points moved to the Witness; originally witnessed by %'
  );

DELETE FROM submission_notes
WHERE note_text LIKE 'Witness reset when points moved to the Witness; originally witnessed by %';

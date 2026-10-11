import { query, writeConn } from "./conn";

export type SubmissionNote = {
  id: number;
  submission_id: number;
  admin_id: number | null;
  admin_name: string | null;
  note_text: string;
  created_at: string;
};

/**
 * Fetch all notes for a submission, ordered chronologically (oldest first)
 * Includes admin name (or null if admin was deleted)
 */
export async function getNotesForSubmission(submissionId: number): Promise<SubmissionNote[]> {
  const notes = await query<SubmissionNote>(
    `SELECT
			sn.id,
			sn.submission_id,
			sn.admin_id,
			m.display_name as admin_name,
			sn.note_text,
			sn.created_at
		FROM submission_notes sn
		LEFT JOIN members m ON sn.admin_id = m.id
		WHERE sn.submission_id = ?
		ORDER BY sn.created_at ASC`,
    [submissionId]
  );
  return notes;
}

/**
 * Which of these Submissions had their Species recorded by the witness: the
 * "Settled at the Witness" changelog entry carries a `new_species` change
 * (`confirmWitness`, src/lifecycle/transitions.ts). One query for a whole
 * queue page, where `speciesRecordedByWitness` (src/routes/submission.ts)
 * reads one Submission's notes.
 */
export async function findSubmissionsWithRecordedSpecies(submissionIds: number[]): Promise<Set<number>> {
  if (submissionIds.length === 0) return new Set();
  const rows = await query<{ submission_id: number }>(
    `SELECT DISTINCT sn.submission_id
     FROM submission_notes sn,
          json_each(CASE WHEN json_valid(sn.note_text) THEN sn.note_text ELSE '{}' END, '$.changes') change
     WHERE sn.submission_id IN (${submissionIds.map(() => "?").join(", ")})
       AND json_extract(sn.note_text, '$.type') = 'admin_edit'
       AND json_extract(change.value, '$.field') = 'new_species'`,
    submissionIds
  );
  return new Set(rows.map((row) => row.submission_id));
}

/**
 * Add a new note to a submission
 */
export async function addNote(
  submissionId: number,
  adminId: number,
  noteText: string
): Promise<number> {
  const stmt = await writeConn.prepare(`
		INSERT INTO submission_notes (submission_id, admin_id, note_text)
		VALUES (?, ?, ?)
	`);

  try {
    const result = await stmt.run(submissionId, adminId, noteText);
    return result.lastID as number;
  } finally {
    await stmt.finalize();
  }
}

/**
 * Update an existing note
 */
export async function updateNote(noteId: number, noteText: string): Promise<void> {
  const stmt = await writeConn.prepare(`
		UPDATE submission_notes
		SET note_text = ?
		WHERE id = ?
	`);

  try {
    await stmt.run(noteText, noteId);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Delete a note
 */
export async function deleteNote(noteId: number): Promise<void> {
  const stmt = await writeConn.prepare(`
		DELETE FROM submission_notes
		WHERE id = ?
	`);

  try {
    await stmt.run(noteId);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Get a single note by ID
 */
export async function getNoteById(noteId: number): Promise<SubmissionNote | null> {
  const notes = await query<SubmissionNote>(
    `SELECT
			sn.id,
			sn.submission_id,
			sn.admin_id,
			m.display_name as admin_name,
			sn.note_text,
			sn.created_at
		FROM submission_notes sn
		LEFT JOIN members m ON sn.admin_id = m.id
		WHERE sn.id = ?`,
    [noteId]
  );
  return notes[0] || null;
}

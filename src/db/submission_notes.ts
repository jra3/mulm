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
export async function updateNote(
	noteId: number,
	noteText: string
): Promise<void> {
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

import { z } from "zod";
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
 * Fetch all notes for a submission, ordered chronologically (oldest first);
 * `created_at` is to the second, so the id breaks ties, which keeps two
 * changelog entries written in the same second in the order they happened.
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
		ORDER BY sn.created_at ASC, sn.id ASC`,
    [submissionId]
  );
  return notes;
}

/** The shape of a changelog note, as `recordAdminEdit` writes it. */
const adminEditNote = z.object({
  type: z.literal("admin_edit"),
  changes: z.array(z.object({ field: z.string() })),
});

/**
 * What a member's save of a submitted Submission invalidated (ADR-0001), as
 * `voidWitness` (src/lifecycle/transitions.ts) records it: a confirmed
 * Witness, or only a Species the committee had chosen, which the next witness
 * is asked about again.
 */
export type MemberSaveVoided = "witness" | "choice";

/** The shape of the changelog note `voidWitness` writes on a member's save. */
const memberSaveNote = z.object({ type: z.literal("member_save") });

/** The note parsed as JSON, or undefined for prose. */
function parsedNote(note: Pick<SubmissionNote, "note_text">): unknown {
  try {
    return JSON.parse(note.note_text);
  } catch {
    return undefined;
  }
}

/** Whether this changelog entry changed `field`. A note that is not JSON, or not an edit, changed nothing. */
function noteChanged(note: Pick<SubmissionNote, "note_text">, field: string): boolean {
  const entry = adminEditNote.safeParse(parsedNote(note));
  return entry.success && entry.data.changes.some((change) => change.field === field);
}

/** Whether any changelog entry changed `field`. */
function changelogChanged(notes: Pick<SubmissionNote, "note_text">[], field: string): boolean {
  return notes.some((note) => noteChanged(note, field));
}

/** The index of the last note that satisfies `test`, or -1. */
function lastIndexWhere<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (test(items[i])) return i;
  }
  return -1;
}

/**
 * Whether the committee bound or rebound the Submission since the member last
 * saved it: a changelog entry that changed its `species`, with no `member_save`
 * entry after it. The member's own pick leaves no such entry, and a member's
 * save voids the Witness (ADR-0001), so a Species the committee chose before
 * it is one the next witness must be asked about again. `notes` are read in
 * changelog order, oldest first, as `getNotesForSubmission` returns them.
 * The witness panel reads it for its "You chose"; `voidWitness` reads it to
 * know whether a save has such a choice to reset.
 */
export function speciesChosenByCommittee(notes: Pick<SubmissionNote, "note_text">[]): boolean {
  return committeeSpeciesChoice(notes) !== null;
}

/**
 * The changelog entry of the committee's choice of Species that still
 * stands (see `speciesChosenByCommittee`), or null. The witness panel reads
 * who made it off `admin_id` and `admin_name`: "You chose" when it was this
 * witness, "<Name> chose" when another committee member bound it first.
 */
export function committeeSpeciesChoice<T extends Pick<SubmissionNote, "note_text">>(notes: T[]): T | null {
  const lastChoice = lastIndexWhere(notes, (note) => noteChanged(note, "species"));
  const lastSave = lastIndexWhere(notes, (note) => memberSaveNote.safeParse(parsedNote(note)).success);
  return lastChoice > lastSave ? notes[lastChoice] : null;
}

/**
 * Whether the witness recorded the Species because the catalogue lacked it
 * (#522): the "Settled at the Witness" entry then carries a `new_species`
 * change. The approval queue reads it as "New species recorded by the
 * witness"; `findSubmissionsWithRecordedSpecies` below answers the same for a
 * whole page of rows.
 */
export function speciesRecordedByWitness(notes: Pick<SubmissionNote, "note_text">[]): boolean {
  return changelogChanged(notes, "new_species");
}

/**
 * Which of these Submissions had their Species recorded by the witness: the
 * "Settled at the Witness" changelog entry carries a `new_species` change
 * (`confirmWitness`, src/lifecycle/transitions.ts). One query for a whole
 * queue page, where `speciesRecordedByWitness` above reads one Submission's
 * notes.
 *
 * Plain-text notes (committee notes, the Witness reset note) share the table
 * with the changelog, and `json_extract` or `json_each` on one of them is an
 * error, not a NULL. The CTE keeps only the valid JSON `admin_edit` entries
 * (a `member_save` entry has no changes), and every JSON function still reads
 * through a `json_valid` CASE, so no planner ordering can hand prose to one
 * of them.
 */
export async function findSubmissionsWithRecordedSpecies(submissionIds: number[]): Promise<Set<number>> {
  if (submissionIds.length === 0) return new Set();
  const rows = await query<{ submission_id: number }>(
    `WITH entry AS (
       SELECT sn.submission_id, sn.note_text
       FROM submission_notes sn
       WHERE sn.submission_id IN (${submissionIds.map(() => "?").join(", ")})
         AND json_valid(sn.note_text)
         AND json_extract(CASE WHEN json_valid(sn.note_text) THEN sn.note_text ELSE '{}' END, '$.type') = 'admin_edit'
     )
     SELECT DISTINCT entry.submission_id
     FROM entry, json_each(CASE WHEN json_valid(entry.note_text) THEN entry.note_text ELSE '{}' END, '$.changes') change
     WHERE json_extract(change.value, '$.field') = 'new_species'`,
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

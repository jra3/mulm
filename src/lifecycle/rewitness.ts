import { query } from "@/db/conn";
import type { MemberRecord } from "@/db/members";
import { updateSetting } from "@/db/settings";
import type { SubmissionNote } from "@/db/submission_notes";
import type { Submission } from "@/db/submissions";
import { logger } from "@/utils/logger";
import { notifier } from "./consequences";
import { requiredWaitingDays, waitingPeriod } from "./state";

/**
 * The reset of in-flight Submissions (#524, ADR-0003), and what follows it.
 *
 * Points are set at the Witness now. A Submission witnessed under the old
 * flow carries none, and there is no legacy approval path, so migration 066
 * (db/migrations/066-reset-pointless-witnesses.sql) sent every witnessed,
 * unapproved, pointless row back to awaiting a Witness and left a note on
 * each saying who had witnessed it and when. Nobody performed that move, so
 * its consequences live here rather than in transitions.ts: the witness panel
 * reads the original witness off the note (no fresh sighting is needed), and
 * a one-off script tells each affected member that nothing is wrong.
 */

const RESET_NOTE_PREFIX = "Witness reset when points moved to the Witness; originally witnessed by ";

/**
 * The note the migration writes on each reset row, attributed to the original
 * witness. The SQL spells it out itself (it runs before any TypeScript does),
 * so this is the TypeScript side of that agreement, kept for the parser and
 * its test: change one and the other must follow.
 */
export function WITNESS_RESET_NOTE(witnessName: string, date: string): string {
  return `${RESET_NOTE_PREFIX}${witnessName} on ${date}`;
}

/** Who saw the fry before the reset, and on what day (YYYY-MM-DD). */
export type OriginalWitness = { name: string; date: string };

/**
 * The original witness of a reset Submission, from its notes: the latest
 * reset note's name and day, or null when it was never reset. Prose that
 * merely mentions a reset, and changelog entries, are not reset notes.
 */
export function originalWitnessFromNotes(notes: Pick<SubmissionNote, "note_text">[]): OriginalWitness | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const text = notes[i].note_text;
    if (!text.startsWith(RESET_NOTE_PREFIX)) continue;
    const match = /^(.+) on (\d{4}-\d{2}-\d{2})$/.exec(text.slice(RESET_NOTE_PREFIX.length));
    if (match) return { name: match[1], date: match[2] };
  }
  return null;
}

/** One reset Submission, as the member's letter lists it. */
export type RewitnessPending = Pick<
  Submission,
  "id" | "species_common_name" | "species_latin_name" | "species_type" | "species_class" | "reproduction_date"
> & {
  originalWitness: OriginalWitness | null;
  /** The day the waiting period ends (YYYY-MM-DD), counted from the reproduction date as before. */
  readyOn: string;
  waitingPeriodOver: boolean;
};

/** One member's letter: every reset Submission of theirs still awaiting a Witness. */
export type RewitnessLetter = { member: MemberRecord; submissions: RewitnessPending[] };

/** The key under which a member's letter is recorded as sent. */
const sentKey = (memberId: number) => `rewitness_emailed:${memberId}`;

type ResetRow = Pick<
  Submission,
  "id" | "member_id" | "species_common_name" | "species_latin_name" | "species_type" | "species_class" | "reproduction_date"
> &
  Pick<MemberRecord, "display_name" | "contact_email" | "is_admin"> & { note_text: string };

/**
 * The members still owed the letter, each with the reset Submissions it is
 * about: rows carrying a reset note that are awaiting a Witness and
 * unapproved (one re-witnessed since has had the points email instead),
 * grouped by member, less the members already written to. The sent record
 * is a setting per member, so the script is safe to run twice.
 */
export async function membersAwaitingRewitnessEmail(): Promise<RewitnessLetter[]> {
  const rows = await query<ResetRow>(
    `SELECT s.id, s.member_id, s.species_common_name, s.species_latin_name, s.species_type,
            s.species_class, s.reproduction_date,
            m.display_name, m.contact_email, m.is_admin,
            (SELECT n.note_text FROM submission_notes n
              WHERE n.submission_id = s.id AND substr(n.note_text, 1, ?) = ?
              ORDER BY n.id DESC LIMIT 1) AS note_text
       FROM submissions s
       JOIN members m ON m.id = s.member_id
      WHERE s.witness_verification_status = 'pending'
        AND s.submitted_on IS NOT NULL
        AND s.approved_on IS NULL
        AND EXISTS (SELECT 1 FROM submission_notes n
                     WHERE n.submission_id = s.id AND substr(n.note_text, 1, ?) = ?)
        AND NOT EXISTS (SELECT 1 FROM settings WHERE settings.key = 'rewitness_emailed:' || s.member_id)
      ORDER BY s.member_id, s.id`,
    [RESET_NOTE_PREFIX.length, RESET_NOTE_PREFIX, RESET_NOTE_PREFIX.length, RESET_NOTE_PREFIX]
  );

  const letters = new Map<number, RewitnessLetter>();
  for (const row of rows) {
    const letter = letters.get(row.member_id) ?? {
      member: {
        id: row.member_id,
        display_name: row.display_name,
        contact_email: row.contact_email,
        is_admin: row.is_admin,
      },
      submissions: [],
    };
    letter.submissions.push(pending(row));
    letters.set(row.member_id, letter);
  }
  return [...letters.values()];
}

function pending(row: ResetRow): RewitnessPending {
  const readyOn = new Date(row.reproduction_date);
  readyOn.setUTCDate(readyOn.getUTCDate() + requiredWaitingDays(row));
  return {
    id: row.id,
    species_common_name: row.species_common_name,
    species_latin_name: row.species_latin_name,
    species_type: row.species_type,
    species_class: row.species_class,
    reproduction_date: row.reproduction_date,
    originalWitness: originalWitnessFromNotes([{ note_text: row.note_text }]),
    readyOn: readyOn.toISOString().slice(0, 10),
    waitingPeriodOver: waitingPeriod(row).elapsed,
  };
}

/**
 * Tell each affected member once: nothing is wrong, the waiting period has
 * not restarted, a committee member will confirm the Submission again, and
 * the points email follows. A member is recorded as written to only after
 * the letter got through, so one with no address or a failed send is tried
 * again next run. Returns the tally for the script's log.
 */
export async function sendRewitnessEmails(): Promise<{ emailed: number; skipped: number; failed: number }> {
  const tally = { emailed: 0, skipped: 0, failed: 0 };
  for (const letter of await membersAwaitingRewitnessEmail()) {
    if (!letter.member.contact_email) {
      logger.warn("Re-witness letter skipped: member has no contact email", {
        memberId: letter.member.id,
        submissionIds: letter.submissions.map((s) => s.id),
      });
      tally.skipped++;
      continue;
    }
    const delivered = await notifier().rewitnessPending(letter.member, letter.submissions);
    if (!delivered) {
      logger.warn("Re-witness letter not delivered; will retry next run", { memberId: letter.member.id });
      tally.failed++;
      continue;
    }
    await updateSetting(sentKey(letter.member.id), new Date().toISOString());
    logger.info("Re-witness letter sent", {
      memberId: letter.member.id,
      submissionIds: letter.submissions.map((s) => s.id),
    });
    tally.emailed++;
  }
  return tally;
}

import { query } from "@/db/conn";
import type { Submission } from "@/db/submissions";
import { totalPointsSql } from "@/points";
import { logger } from "@/utils/logger";
import { filterQueue } from "./queues";
import { notifier } from "./consequences";

/**
 * The waiting period elapsing is the one move nobody performs: the clock does
 * it. Telling the member is still a lifecycle consequence rather than a job
 * that happens to email, so the module says who is due and what they are told,
 * and the scheduler keeps only the cadence and the sent-flag.
 */

export interface MeetingReminderDue extends Submission {
  contact_email: string;
  member_name: string;
}

/**
 * Members whose waiting period has been served and who have not yet been told:
 * the approval queue, less the rows already reminded.
 *
 * The SQL selects everything expressible in SQL; the per-species waiting period
 * is applied afterwards by the queue predicate, the same rule the approval
 * queue page reads. The sent-flag is never cleared, so a Submission is
 * reminded once, however many times it is re-witnessed.
 */
export async function submissionsDueForMeetingReminder(
  now: Date = new Date()
): Promise<MeetingReminderDue[]> {
  const candidates = await query<MeetingReminderDue>(
    `SELECT submissions.*,
            ${totalPointsSql("submissions")} as total_points,
            members.contact_email,
            members.display_name AS member_name
       FROM submissions
       LEFT JOIN members ON submissions.member_id = members.id
      WHERE submissions.final_submission_reminder_sent_on IS NULL`
  );

  return filterQueue("approval", candidates, now);
}

/**
 * Tell one member their waiting period is served and the fry, plants or coral
 * can come to a meeting. Returns whether the letter was delivered, so the
 * caller knows whether to record it as sent.
 */
export async function sendMeetingReminder(due: MeetingReminderDue): Promise<boolean> {
  if (!due.contact_email) {
    logger.warn("Skipping meeting reminder: submitter has no contact email", {
      submissionId: due.id,
    });
    return false;
  }

  return notifier().waitingPeriodComplete(due, {
    contact_email: due.contact_email,
    display_name: due.member_name,
  });
}

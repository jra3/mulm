import { ready } from "@/db/conn";
import { logger } from "@/utils/logger";
import { markFinalSubmissionReminderSent } from "@/db/submissions";
import { sendMeetingReminder, submissionsDueForMeetingReminder } from "@/lifecycle";

/**
 * The waiting period elapsing is the one move nobody performs, and telling the
 * member is its consequence. The lifecycle module says who is due and what
 * they are told; this job keeps only the cadence and the sent-flag.
 *
 * Idempotent: only emails submissions not yet reminded, and marks each as
 * reminded only after a successful send — so a transient email failure is
 * retried on the next run rather than silently dropped.
 */
export async function runFinalSubmissionReminders(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    await ready;

    const candidates = await submissionsDueForMeetingReminder();
    if (candidates.length === 0) {
      logger.info("No submissions awaiting final-submission reminder");
      return { sent, failed };
    }

    logger.info(`Sending final-submission reminders to ${candidates.length} submitter(s)`);

    for (const submission of candidates) {
      const delivered = await sendMeetingReminder(submission);

      if (delivered) {
        await markFinalSubmissionReminderSent(submission.id);
        sent++;
      } else {
        failed++;
        logger.warn("Final-submission reminder not sent; will retry next run", {
          submissionId: submission.id,
        });
      }
    }

    logger.info(`Final-submission reminders complete: sent=${sent}, failed=${failed}`);
  } catch (err) {
    logger.error("Error sending final-submission reminders", err);
  }

  return { sent, failed };
}

let reminderInterval: NodeJS.Timeout | null = null;

/**
 * Start the daily final-submission reminder task.
 * Runs immediately on startup (to catch any missed days while the machine was
 * stopped — Fly scales to zero) and then daily at 4:00 AM server time.
 */
export function startFinalSubmissionReminders(): void {
  // Run on startup to catch up on anything missed while the machine was stopped.
  void runFinalSubmissionReminders();

  const now = new Date();
  const next4AM = new Date();
  next4AM.setHours(4, 0, 0, 0);
  if (now.getHours() >= 4) {
    next4AM.setDate(next4AM.getDate() + 1);
  }
  const msUntilNext4AM = next4AM.getTime() - now.getTime();

  logger.info(`Next final-submission reminder run scheduled for ${next4AM.toISOString()}`);

  setTimeout(() => {
    void runFinalSubmissionReminders();
    reminderInterval = setInterval(
      () => {
        void runFinalSubmissionReminders();
      },
      24 * 60 * 60 * 1000
    );
  }, msUntilNext4AM);
}

/** Stop the scheduled reminder task (graceful shutdown / tests). */
export function stopFinalSubmissionReminders(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    logger.info("Scheduled final-submission reminders stopped");
  }
}

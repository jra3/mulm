import { ready } from "@/db/conn";
import { sendCommitteeDigest } from "@/lifecycle";
import { logger } from "@/utils/logger";

/**
 * The committee's daily digest of what is still waiting on them.
 *
 * The cadence lives here; what the digest contains and whether there is one to
 * send lives in the lifecycle module. It keeps arriving while a queue is
 * non-empty - which per-event mail cannot do, and with a committee of three,
 * work being forgotten is the actual failure mode.
 */
export async function runCommitteeDigest(): Promise<boolean> {
  try {
    await ready;
    return await sendCommitteeDigest();
  } catch (err) {
    logger.error("Error sending committee digest", err);
    return false;
  }
}

let digestInterval: NodeJS.Timeout | null = null;

/**
 * Start the daily committee digest. Runs on startup to catch up on anything
 * missed while the machine was stopped (Fly scales to zero), then daily at
 * 7:00 AM server time - after the 4:00 AM reminder pass, so a member nudged
 * this morning who queues their Submission is already in today's digest.
 */
export function startCommitteeDigest(): void {
  void runCommitteeDigest();

  const now = new Date();
  const next = new Date();
  next.setHours(7, 0, 0, 0);
  if (now.getHours() >= 7) {
    next.setDate(next.getDate() + 1);
  }

  logger.info(`Next committee digest scheduled for ${next.toISOString()}`);

  setTimeout(
    () => {
      void runCommitteeDigest();
      digestInterval = setInterval(
        () => {
          void runCommitteeDigest();
        },
        24 * 60 * 60 * 1000
      );
    },
    next.getTime() - now.getTime()
  );
}

/** Stop the scheduled digest (graceful shutdown / tests). */
export function stopCommitteeDigest(): void {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
    logger.info("Scheduled committee digest stopped");
  }
}

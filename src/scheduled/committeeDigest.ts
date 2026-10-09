import { ready } from "@/db/conn";
import { getSetting, updateSetting } from "@/db/settings";
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

const DIGEST_HOUR = 7;
const LAST_RUN_KEY = "committee_digest_last_run";

/** The most recent 7:00 AM (server time) at or before `now`. */
export function currentDigestSlot(now: Date): Date {
  const slot = new Date(now);
  slot.setHours(DIGEST_HOUR, 0, 0, 0);
  if (slot > now) {
    slot.setDate(slot.getDate() - 1);
  }
  return slot;
}

/**
 * Run the digest at most once per daily slot. The machine scales to zero and
 * every boot calls this, so without the recorded last run each cold start
 * would mail the committee again. A pass that finds every queue empty still
 * counts as the slot's run. A send that throws is not recorded, so the next
 * boot retries it.
 */
export async function runCommitteeDigest(now: Date = new Date()): Promise<boolean> {
  try {
    await ready;

    const lastRun = await getSetting(LAST_RUN_KEY);
    if (lastRun && new Date(lastRun) >= currentDigestSlot(now)) {
      logger.info("Committee digest already ran for this slot", { lastRun });
      return false;
    }

    const sent = await sendCommitteeDigest();
    await updateSetting(LAST_RUN_KEY, now.toISOString());
    return sent;
  } catch (err) {
    logger.error("Error sending committee digest", err);
    return false;
  }
}

let digestInterval: NodeJS.Timeout | null = null;

/**
 * Start the daily committee digest. Runs on startup to catch up on a slot
 * missed while the machine was stopped (Fly scales to zero), then daily at
 * 7:00 AM server time - after the 4:00 AM reminder pass, so a member nudged
 * this morning who queues their Submission is already in today's digest.
 */
export function startCommitteeDigest(): void {
  void runCommitteeDigest();

  const now = new Date();
  const next = new Date();
  next.setHours(DIGEST_HOUR, 0, 0, 0);
  if (now.getHours() >= DIGEST_HOUR) {
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

import { getAdminEmails } from "@/db/members";
import { getQueue, type QueueSubmission } from "@/db/submissions";
import { programs, isProgramType, programMetadata } from "@/programs";
import { logger } from "@/utils/logger";
import type { CommitteeDigest, DigestSection } from "@/notifications";
import type { QueueName } from "./queues";
import { notifier } from "./consequences";

/**
 * What is still waiting on the committee, per Program.
 *
 * This replaces cc'ing three committee members on every member's confirmation
 * letter. One email, sent only when something is waiting, and it keeps arriving
 * while a queue is non-empty - which per-event mail cannot do, and with a
 * committee of three, work being forgotten is the actual failure mode.
 *
 * Only the witness queue is reported. The approval queue waits on the member
 * bringing the fry, plants or coral to a meeting, where a committee member
 * approves it on the spot; a daily nag about rows nobody on the committee can
 * move would teach them to ignore the digest.
 *
 * The digest is not scoped per Program member: `is_admin` is a single boolean
 * with no Program dimension, and all three committee members already see all
 * three Programs. Every committee member gets every Program's section.
 */

/** The queues the digest reports, and how each is named to a committee member. */
const REPORTED_QUEUES: ReadonlyArray<{ queue: QueueName; title: string }> = [
  { queue: "witness", title: "Waiting to be screened" },
];

/**
 * Build the digest, or return null when every queue is empty - no digest at
 * all when there is nothing to do, so the mail means something when it comes.
 */
export async function buildCommitteeDigest(): Promise<CommitteeDigest | null> {
  const sections: DigestSection[] = [];

  for (const program of programs) {
    if (!isProgramType(program)) {
      continue;
    }
    for (const { queue, title } of REPORTED_QUEUES) {
      const submissions = await getQueue(queue, program);
      if (submissions.length > 0) {
        sections.push({
          program,
          programName: programMetadata[program].name,
          queue,
          title,
          submissions: submissions.map(summarize),
        });
      }
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return {
    sections,
    total: sections.reduce((sum, section) => sum + section.submissions.length, 0),
  };
}

function summarize(submission: QueueSubmission) {
  return {
    id: submission.id,
    memberName: submission.member_name,
    speciesCommonName: submission.species_common_name,
    speciesLatinName: submission.species_latin_name,
    waitingSince: submission.submitted_on,
  };
}

/**
 * Send today's digest, if there is one. Returns whether an email went out.
 * The scheduler owns only the cadence.
 */
export async function sendCommitteeDigest(): Promise<boolean> {
  const digest = await buildCommitteeDigest();
  if (!digest) {
    logger.info("Committee digest: every queue is empty, sending nothing");
    return false;
  }

  const recipients = await getAdminEmails();
  if (recipients.length === 0) {
    logger.warn("Committee digest: nothing waiting on nobody - no committee emails on file");
    return false;
  }

  await notifier().committeeDigest(recipients, digest);
  logger.info("Committee digest sent", { recipients: recipients.length, items: digest.total });
  return true;
}

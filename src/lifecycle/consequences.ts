import type { Submission } from "@/db/submissions";
import type { MemberRecord } from "@/db/members";
import type { Program } from "@/levelManager";
import {
  onChangesRequested,
  onLevelUpgrade,
  onScreeningApproved,
  onSpecialtyAward,
  onSubmissionApprove,
  onSubmissionDeleted,
  onSubmissionSend,
  onWaitingPeriodComplete,
  onCommitteeDigest,
  type CommitteeDigest,
} from "@/notifications";

/**
 * Who gets told what, as one interface.
 *
 * This is the module's own seam, not part of its interface: callers never see
 * it. It exists because email recipients are the one consequence a test cannot
 * observe in the database - emails are disabled whenever NODE_ENV is test - and
 * who receives which letter is exactly what this work changes. The module's
 * tests swap the notifier for a recorder; everything else about a transition is
 * asserted through the database.
 */
export interface Notifier {
  /** A member's Submission reached the committee. */
  submissionReceived(submission: Submission, member: MemberRecord): Promise<void>;
  /** A committee member inspected the spawn; the waiting period has started. */
  witnessConfirmed(
    submission: Submission,
    member: MemberRecord,
    witness: MemberRecord
  ): Promise<void>;
  /** The waiting period is served. Returns whether the letter was delivered. */
  waitingPeriodComplete(
    submission: Submission,
    member: Pick<MemberRecord, "contact_email" | "display_name">
  ): Promise<boolean>;
  /** The committee wants something changed, and says what. */
  changesRequested(
    submission: Submission,
    member: MemberRecord,
    reason: string
  ): Promise<void>;
  /** The Points are recorded. */
  approved(submission: Submission, member: MemberRecord): Promise<void>;
  /** A committee member deleted work that was not their own. */
  deletedByCommittee(submission: Submission, member: MemberRecord): Promise<void>;
  /** The member reached a new Level. Only ever a rise. */
  levelUp(
    member: MemberRecord,
    program: Program,
    newLevel: string,
    totalPoints: number
  ): Promise<void>;
  /** The member earned a Specialty Award. */
  specialtyAward(member: MemberRecord, awardName: string): Promise<void>;
  /** The committee's daily digest of what is still waiting on them. */
  committeeDigest(recipients: string[], digest: CommitteeDigest): Promise<void>;
}

/** The real notifier: the Portal's email templates, unchanged. */
const emailNotifier: Notifier = {
  submissionReceived: onSubmissionSend,
  witnessConfirmed: onScreeningApproved,
  waitingPeriodComplete: onWaitingPeriodComplete,
  changesRequested: onChangesRequested,
  approved: onSubmissionApprove,
  deletedByCommittee: onSubmissionDeleted,
  levelUp: onLevelUpgrade,
  specialtyAward: onSpecialtyAward,
  committeeDigest: onCommitteeDigest,
};

let current: Notifier = emailNotifier;

/** The notifier the transitions call. */
export function notifier(): Notifier {
  return current;
}

/** Swap in a recorder. Tests only; call `resetNotifier` afterwards. */
export function setNotifier(replacement: Notifier): void {
  current = replacement;
}

/** Restore the email notifier. */
export function resetNotifier(): void {
  current = emailNotifier;
}

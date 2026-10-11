import type { Submission } from "@/db/submissions";
import type { MemberRecord } from "@/db/members";
import type { Program } from "@/levelManager";
import {
  onChangesRequested,
  onLevelUpgrade,
  onWitnessConfirmed,
  onSpecialtyAward,
  onSubmissionApprove,
  onSubmissionDeleted,
  onSubmissionSend,
  onWaitingPeriodComplete,
  onCommitteeDigest,
  onRewitnessPending,
  type CommitteeDigest,
} from "@/notifications";
import type { RewitnessPending } from "./rewitness";

/**
 * What the Witness letter says beyond the row itself: whether the Species
 * had no approved Submission at the Witness, so the member may be the first
 * to bring it in and earn the first-time bonus at the meeting. Approval
 * computes first-time; the letter only says it is possible. When the letter
 * goes again because the committee corrected the points before approval
 * (#528), `correctionReason` is the reason it gave, and the letter says so.
 */
export type WitnessedFacts = {
  firstTime: boolean;
  correctionReason?: string;
};

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
  /**
   * A committee member inspected the spawn and set the points (#526): the one
   * letter the member gets at the Witness, carrying the full breakdown off the
   * row as written, while there is still time to dispute it. Sent again, with
   * the reason, when the committee corrects the points before approval.
   */
  witnessConfirmed(
    submission: Submission,
    member: MemberRecord,
    witness: MemberRecord,
    facts: WitnessedFacts
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
  /**
   * The member's Submissions were reset for a second Witness (#524): nothing
   * is wrong, nothing restarts. Returns whether the letter was delivered.
   */
  rewitnessPending(member: MemberRecord, submissions: RewitnessPending[]): Promise<boolean>;
}

/** The real notifier: the Portal's email templates, unchanged. */
const emailNotifier: Notifier = {
  submissionReceived: onSubmissionSend,
  witnessConfirmed: onWitnessConfirmed,
  waitingPeriodComplete: onWaitingPeriodComplete,
  changesRequested: onChangesRequested,
  approved: onSubmissionApprove,
  deletedByCommittee: onSubmissionDeleted,
  levelUp: onLevelUpgrade,
  specialtyAward: onSpecialtyAward,
  committeeDigest: onCommitteeDigest,
  rewitnessPending: onRewitnessPending,
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

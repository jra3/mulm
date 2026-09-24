import type { Submission } from "@/db/submissions";

/**
 * A Submission's state, derived from its row in one place.
 *
 * A badge, a queue and a guard all read this, so they cannot disagree about
 * where a Submission is. Deleted is a seventh state with no row to derive it
 * from, so it is not in this union: a deleted Submission is simply gone.
 *
 * | State                   | Stored as                                           |
 * |-------------------------|-----------------------------------------------------|
 * | draft                   | submitted_on null                                   |
 * | pendingWitness          | submitted, witness_verification_status = 'pending'   |
 * | waitingPeriod           | witness confirmed, waiting period not yet elapsed    |
 * | awaitingFinalSubmission | witness confirmed, elapsed, final_submission_on null |
 * | inApprovalQueue         | final_submission_on set                             |
 * | approved                | approved_on set - terminal                           |
 */
export type SubmissionState =
  | "draft"
  | "pendingWitness"
  | "waitingPeriod"
  | "awaitingFinalSubmission"
  | "inApprovalQueue"
  | "approved";

/**
 * The four states a submitted, unapproved Submission can be in: everything
 * between Draft and Approved. Save Changes, Request changes and Resubmit are
 * legal from all four, so the table names this rather than listing them.
 */
export const MIDDLE_STATES = [
  "pendingWitness",
  "waitingPeriod",
  "awaitingFinalSubmission",
  "inApprovalQueue",
] as const satisfies readonly SubmissionState[];

/** The columns the derivation reads. Anything row-shaped will do. */
export type StateRow = Pick<
  Submission,
  | "submitted_on"
  | "approved_on"
  | "witness_verification_status"
  | "final_submission_on"
  | "reproduction_date"
  | "species_type"
  | "species_class"
> &
  Partial<Pick<Submission, "changes_requested_on">>;

/**
 * How long a Submission must age from its reproduction_date before it may
 * enter the approval queue: 30 days for marine fish, 60 days for everything
 * else.
 */
export function requiredWaitingDays(
  row: Pick<Submission, "species_type" | "species_class">
): number {
  return row.species_type === "Fish" && row.species_class === "Marine" ? 30 : 60;
}

/** Whole days elapsed since a reproduction date. */
export function daysElapsedSince(reproductionDate: string, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - new Date(reproductionDate).getTime();
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

/**
 * The waiting-period clock for one Submission.
 *
 * This is the one edge the module computes rather than performs: Waiting period
 * and Awaiting final submission are stored identically and separated only by
 * this comparison. It is in the table because entering the approval queue is
 * legal on one side of it and not the other.
 */
export function waitingPeriod(
  row: Pick<Submission, "species_type" | "species_class" | "reproduction_date">,
  now: Date = new Date()
): { requiredDays: number; elapsedDays: number; daysRemaining: number; elapsed: boolean } {
  const requiredDays = requiredWaitingDays(row);
  const elapsedDays = daysElapsedSince(row.reproduction_date, now);
  const daysRemaining = Math.max(0, requiredDays - elapsedDays);
  return { requiredDays, elapsedDays, daysRemaining, elapsed: daysRemaining === 0 };
}

/**
 * The Changes requested overlay: a flag laid over whichever state it is in.
 *
 * A row that does not carry the column at all - a lean select that did not ask
 * for it - reads as unflagged, the same as one that carries a null.
 */
export function hasChangesRequested(row: Partial<Pick<Submission, "changes_requested_on">>): boolean {
  return row.changes_requested_on != null;
}

/**
 * Whether a Submission carries a confirmed Witness - the one a member's save
 * would void (ADR-0001). A Draft withdrawn after witnessing still carries it
 * until it is submitted again.
 */
export function hasConfirmedWitness(
  row: Pick<Submission, "witness_verification_status" | "approved_on">
): boolean {
  return row.witness_verification_status === "confirmed" && !row.approved_on;
}

/**
 * Where a Submission is, from its row.
 *
 * Read top to bottom: Approved wins over everything (it is terminal), then the
 * absence of a submission date means Draft, then the Witness gate, then the
 * clock, then whether the member has brought it to a meeting.
 *
 * Changes requested is deliberately absent - it is an overlay, not a state, so
 * flagged work stays where it is and keeps its place in the pipeline.
 */
export function deriveState(row: StateRow, now: Date = new Date()): SubmissionState {
  if (row.approved_on) {
    return "approved";
  }
  if (!row.submitted_on) {
    return "draft";
  }
  // Anything not confirmed is waiting on a Witness. The dead 'declined' value
  // lands here too, which rescues the rows it stranded: a declined Submission
  // is once again something the committee can confirm or request changes on.
  if (row.witness_verification_status !== "confirmed") {
    return "pendingWitness";
  }
  if (row.final_submission_on) {
    return "inApprovalQueue";
  }
  return waitingPeriod(row, now).elapsed ? "awaitingFinalSubmission" : "waitingPeriod";
}

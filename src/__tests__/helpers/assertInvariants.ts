import { Submission } from "../../db/submissions";
import { deriveState, hasChangesRequested } from "../../lifecycle";

/**
 * The invariants the transition table makes explicit, asserted against a row.
 *
 * Call it after any transition. These are the statements that must hold no
 * matter which move ran, so a suite testing one move still catches another
 * move's damage.
 */
export async function assertSubmissionInvariantsHold(submission: Submission | null): Promise<void> {
  if (!submission) {
    throw new Error("Submission is null - cannot check invariants");
  }

  const violation = (message: string): never => {
    throw new Error(`INVARIANT VIOLATION: Submission ${submission.id} ${message}`);
  };

  // Approved is terminal, and the ball is never with the member there.
  if (submission.approved_on && hasChangesRequested(submission)) {
    violation("is approved but has changes outstanding");
  }
  if (submission.approved_on && !submission.submitted_on) {
    violation("is approved but was never submitted");
  }
  if (submission.approved_on && !submission.points) {
    violation("is approved but has no points");
  }
  if (submission.approved_on && !submission.approved_by) {
    violation("is approved but has no approver");
  }

  // The Witness: its date and its author travel together.
  if (submission.witnessed_on && !submission.witnessed_by) {
    violation("has a witness date but no witness");
  }
  if (submission.witnessed_by && !submission.witnessed_on) {
    violation("has a witness but no witness date");
  }
  if (submission.witness_verification_status === "confirmed") {
    if (!submission.witnessed_on || !submission.witnessed_by) {
      violation("has a confirmed Witness but no witness data");
    }
  }
  if (submission.witness_verification_status === "pending") {
    if (submission.witnessed_on || submission.witnessed_by) {
      violation("is awaiting a Witness but already carries witness data");
    }
  }

  // The Witness sets the points (ADR-0003), and a member's save voids both
  // together: an unapproved row carrying points is always witnessed. First-time
  // is approval's to compute, so it is never set before then.
  if (!submission.approved_on) {
    if (submission.points != null && submission.witness_verification_status !== "confirmed") {
      violation("carries points but no confirmed Witness");
    }
    if (submission.first_time_species != null) {
      violation("is not approved but already carries first-time");
    }
  }

  // The gates happen in order. `submitted_on` may still *follow*
  // `witnessed_on` on rows witnessed before ADR-0001, when a confirmed Witness
  // survived a trip back to Draft; today resubmitting voids the Witness.
  if (submission.witnessed_on && submission.approved_on) {
    if (new Date(submission.witnessed_on) > new Date(submission.approved_on)) {
      violation("was witnessed after it was approved");
    }
  }

  // A request for changes carries its author and its reason, or it tells the
  // member nothing.
  if (submission.changes_requested_on) {
    if (!submission.changes_requested_by || !submission.changes_requested_reason) {
      violation("has changes outstanding but no author or reason");
    }
  }

  // And the row must resolve to a state the table names.
  deriveState(submission);
}

import { Submission } from "../../db/submissions";

/**
 * Assert that a submission maintains all state machine invariants
 * This is a comprehensive check that should be called after any state transition
 * to ensure the database never contains invalid/impossible states
 */
export async function assertSubmissionInvariantsHold(submission: Submission | null): Promise<void> {
  if (!submission) {
    throw new Error("Submission is null - cannot check invariants");
  }

  // MUTUAL EXCLUSIVITY INVARIANTS
  // ==============================

  // Cannot be both approved and denied
  if (submission.approved_on && submission.denied_on) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} is both approved AND denied`
    );
  }

  // Cannot have changes_requested if approved
  if (submission.changes_requested_on && submission.approved_on) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} has changes_requested_on but is approved`
    );
  }

  // Cannot have changes_requested if denied
  if (submission.changes_requested_on && submission.denied_on) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} has changes_requested_on but is denied`
    );
  }

  // REQUIRED FIELD CONSTRAINTS
  // ===========================

  // If witnessed_on is set, witnessed_by must be set
  if (submission.witnessed_on && !submission.witnessed_by) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} has witnessed_on but no witnessed_by`
    );
  }

  // If witnessed_by is set, witnessed_on must be set
  if (submission.witnessed_by && !submission.witnessed_on) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} has witnessed_by but no witnessed_on`
    );
  }

  // If approved, points must be set
  if (submission.approved_on && !submission.points) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} is approved but has no points`
    );
  }

  // If approved, approved_by must be set
  if (submission.approved_on && !submission.approved_by) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} is approved but has no approved_by`
    );
  }

  // If denied, denied_by must be set
  if (submission.denied_on && !submission.denied_by) {
    throw new Error(
      `INVARIANT VIOLATION: Submission ${submission.id} is denied but has no denied_by`
    );
  }

  // WITNESS STATUS CONSISTENCY
  // ===========================

  // If witness_verification_status is confirmed, witnessed data must be set
  if (submission.witness_verification_status === "confirmed") {
    if (!submission.witnessed_on || !submission.witnessed_by) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} is confirmed but missing witness data`
      );
    }
  }

  // If witness_verification_status is declined, witnessed data must be set
  if (submission.witness_verification_status === "declined") {
    if (!submission.witnessed_on || !submission.witnessed_by) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} is declined but missing witness data`
      );
    }
  }

  // If witness_verification_status is pending, witnessed data should be NULL
  if (submission.witness_verification_status === "pending") {
    if (submission.witnessed_on || submission.witnessed_by) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} is pending but has witness data set`
      );
    }
  }

  // TIMESTAMP ORDERING INVARIANTS
  // ==============================

  // submitted_on must be <= witnessed_on (if both set)
  if (submission.submitted_on && submission.witnessed_on) {
    const submittedDate = new Date(submission.submitted_on);
    const witnessedDate = new Date(submission.witnessed_on);
    if (submittedDate > witnessedDate) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} has submitted_on after witnessed_on`
      );
    }
  }

  // witnessed_on must be <= approved_on (if both set)
  if (submission.witnessed_on && submission.approved_on) {
    const witnessedDate = new Date(submission.witnessed_on);
    const approvedDate = new Date(submission.approved_on);
    if (witnessedDate > approvedDate) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} has witnessed_on after approved_on`
      );
    }
  }

  // witnessed_on must be <= denied_on (if both set)
  if (submission.witnessed_on && submission.denied_on) {
    const witnessedDate = new Date(submission.witnessed_on);
    const deniedDate = new Date(submission.denied_on);
    if (witnessedDate > deniedDate) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} has witnessed_on after denied_on`
      );
    }
  }

  // changes_requested_on must be >= submitted_on (if both set)
  if (submission.changes_requested_on && submission.submitted_on) {
    const changesDate = new Date(submission.changes_requested_on);
    const submittedDate = new Date(submission.submitted_on);
    if (changesDate < submittedDate) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} has changes_requested_on before submitted_on`
      );
    }
  }

  // CHANGES REQUESTED FIELD CONSISTENCY
  // ====================================

  // If changes_requested_on is set, reason and by must be set
  if (submission.changes_requested_on) {
    if (!submission.changes_requested_by || !submission.changes_requested_reason) {
      throw new Error(
        `INVARIANT VIOLATION: Submission ${submission.id} has changes_requested_on but missing by/reason`
      );
    }
  }

  // All invariants passed!
}

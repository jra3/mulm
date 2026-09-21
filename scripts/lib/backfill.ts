import { createSubmissionRow, formToRow, updateSubmission } from "@/db/submissions";
import type { FormValues } from "@/forms/submission";
import type { PointsRow } from "@/points";

/**
 * Row writers for backfills and test-data generation.
 *
 * Importing a member's twenty-year history is not twenty members living through
 * the lifecycle: nobody should be emailed a confirmation for a spawn from 2011,
 * and no digest should announce work that was approved a decade ago. These
 * write the rows an already-finished Submission would have left behind.
 *
 * Anything a member or committee member actually does goes through
 * `@/lifecycle` instead, which is where the guards and the consequences live.
 */

/** Insert a Submission, as a Draft or already submitted. */
export async function backfillSubmission(
  memberId: number,
  form: FormValues,
  submit: boolean
): Promise<number> {
  return createSubmissionRow({
    ...formToRow(memberId, form),
    submitted_on: submit ? new Date().toISOString() : undefined,
    witness_verification_status: submit ? "pending" : undefined,
  });
}

/** Stamp a Witness on a Submission, as a committee member's inspection would. */
export async function backfillWitness(
  submissionId: number,
  witnessId: number,
  witnessedOn: Date = new Date()
): Promise<void> {
  await updateSubmission(submissionId, {
    witnessed_by: witnessId,
    witnessed_on: witnessedOn.toISOString(),
    witness_verification_status: "confirmed",
  });
}

/** Put a Submission in the approval queue, as bringing it to a meeting would. */
export async function backfillQueued(
  submissionId: number,
  queuedOn: Date = new Date()
): Promise<void> {
  await updateSubmission(submissionId, { final_submission_on: queuedOn.toISOString() });
}

/**
 * Stamp a Submission approved with its Points. Sends nothing and recomputes
 * nothing - run `scripts/sweep-member-levels.ts` afterwards to bring the
 * members' standings into line.
 */
export async function backfillApproval(
  approvedBy: number,
  submissionId: number,
  speciesIds: { common_name_id: number; scientific_name_id: number },
  approval: PointsRow & Record<string, unknown>,
  approvedOn: Date = new Date()
): Promise<void> {
  await updateSubmission(submissionId, {
    common_name_id: speciesIds.common_name_id,
    scientific_name_id: speciesIds.scientific_name_id,
    points: approval.points ?? 0,
    article_points: approval.article_points ?? 0,
    first_time_species: approval.first_time_species ? 1 : 0,
    cares_species: approval.cares_species ? 1 : 0,
    flowered: approval.flowered ? 1 : 0,
    sexual_reproduction: approval.sexual_reproduction ? 1 : 0,
    approved_by: approvedBy,
    approved_on: approvedOn.toISOString(),
    final_submission_on: approvedOn.toISOString(),
  } as never);
}

import type { Submission } from "@/db/submissions";
import { deriveState, hasChangesRequested, StateRow, SubmissionState } from "./state";

/**
 * Queue membership, defined once per queue.
 *
 * The rule is genuinely split across SQL and JS - the per-species waiting
 * period cannot be expressed in SQL, because it depends on the species type and
 * class - so each queue is written twice, as a SQL fragment a query composes
 * and as a TypeScript predicate applied to the rows that come back. This
 * follows the precedent `src/points.ts` set for the Points rule.
 *
 * The three queues are exactly the three middle states, so no two of them can
 * claim the same Submission. Compose them; do not restate them.
 */
export type QueueName =
  /** Waiting on a committee member to screen it. */
  | "witness"
  /** Waiting on the clock. */
  | "waitingPeriod"
  /**
   * Waiting on the member to bring it to a meeting, where a committee member
   * approves it. The clock puts a witnessed Submission here; the member does
   * nothing to enter it.
   */
  | "approval";

/** The state each queue holds. */
const queueState: Record<QueueName, SubmissionState> = {
  witness: "pendingWitness",
  waitingPeriod: "waitingPeriod",
  approval: "inApprovalQueue",
};

/**
 * The queues a committee member acts on: what a Submission leaves when the
 * committee requests changes on it. The daily digest reports only the witness
 * queue (see digest.ts): the approval queue waits on the member coming to a
 * meeting, not on the committee.
 */
export const COMMITTEE_QUEUES: readonly QueueName[] = ["witness", "approval"];

/**
 * Whether outstanding changes take a Submission out of this queue.
 *
 * While changes are outstanding the ball is with the member, and no committee
 * action but Delete is legal - so a committee queue must not show the work, or
 * it advertises something nobody may act on. The waiting-period queue keeps
 * flagged work, because that work still has a waiting period to serve.
 */
function excludesFlagged(queue: QueueName): boolean {
  return COMMITTEE_QUEUES.includes(queue);
}

/** The columns a queue predicate reads. */
export type QueueRow = StateRow & Pick<Submission, "changes_requested_on">;

/**
 * The SQL-expressible half of a queue's membership, over the submissions table.
 *
 * Everything but the per-species waiting period: pass the rows this selects
 * through `filterQueue` to apply the rest.
 */
export function queueSql(queue: QueueName, alias: "submissions" | "s" = "submissions"): string {
  const clauses = [`${alias}.submitted_on IS NOT NULL`, `${alias}.approved_on IS NULL`];

  // The waiting-period and approval queues are stored identically; only the
  // clock, applied by `filterQueue`, tells them apart.
  if (queue === "witness") {
    clauses.push(`${alias}.witness_verification_status != 'confirmed'`);
  } else {
    clauses.push(`${alias}.witness_verification_status = 'confirmed'`);
  }

  if (excludesFlagged(queue)) {
    clauses.push(`${alias}.changes_requested_on IS NULL`);
  }

  return clauses.join("\n\t\t\tAND ");
}

/** Whether one row is in a queue. The whole rule, clock included. */
export function inQueue(queue: QueueName, row: QueueRow, now: Date = new Date()): boolean {
  if (excludesFlagged(queue) && hasChangesRequested(row)) {
    return false;
  }
  return deriveState(row, now) === queueState[queue];
}

/** The rows of `rows` that are in `queue`. */
export function filterQueue<T extends QueueRow>(
  queue: QueueName,
  rows: T[],
  now: Date = new Date()
): T[] {
  return rows.filter((row) => inQueue(queue, row, now));
}

/**
 * The queue a Submission is in, or null if it is in none - a Draft, an
 * Approved Submission, or work the committee has sent back.
 */
export function queueFor(row: QueueRow, now: Date = new Date()): QueueName | null {
  const names = Object.keys(queueState) as QueueName[];
  return names.find((queue) => inQueue(queue, row, now)) ?? null;
}

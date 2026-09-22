/**
 * The Submission lifecycle.
 *
 * One module owns when a Submission may change state, who may change it, and
 * what follows. Every transition goes through here, every guard is stated once
 * in `table.ts`, and every consequence - the member's email, the committee's
 * visibility, the activity feed entry, the Level and Specialty Award recompute,
 * the audit note - hangs off the transition that causes it rather than off
 * whichever route handler happens to perform the write.
 *
 * What it does not own: Zod form mapping, species-name resolution, image upload
 * and R2, the Points formula, Program rules, and the Level ladder and Specialty
 * Award definitions. The module takes values already validated and resolved,
 * and calls the Level and Specialty Award modules as consequences rather than
 * absorbing them.
 *
 * The line: this module owns when a Submission may change state and what
 * follows, not what a Submission's contents mean.
 *
 * This index is the interface. Everything behind it - the transition
 * definitions, the state derivation, the queue predicates and the consequence
 * sink - is the module's own business, and its own tests' seams.
 */

// The states, and where a Submission is.
export {
  deriveState,
  hasChangesRequested,
  hasConfirmedWitness,
  waitingPeriod,
  requiredWaitingDays,
  daysElapsedSince,
  MIDDLE_STATES,
  type SubmissionState,
  type StateRow,
} from "./state";

// The table: which moves are legal from which states, and for whom.
export {
  moves,
  canMove,
  legalFrom,
  label as stateLabel,
  type Actor,
  type MoveId,
  type MoveDefinition,
  type MoveContext,
} from "./table";

// Queue membership, one definition per queue.
export {
  queueSql,
  inQueue,
  filterQueue,
  queueFor,
  COMMITTEE_QUEUES,
  type QueueName,
  type QueueRow,
} from "./queues";

// The transitions, one function per move.
export {
  createSubmission,
  saveDraft,
  submit,
  saveChanges,
  returnToDraft,
  resubmit,
  confirmWitness,
  enterApprovalQueue,
  removeFromQueue,
  requestChanges,
  approve,
  correctPoints,
  bindSpecies,
  deleteSubmission,
  supplementsFromForm,
  changesBetween,
  type Caller,
  type Change,
} from "./transitions";

// The clock's consequence, and the committee's standing view of its own work.
export {
  submissionsDueForMeetingReminder,
  sendMeetingReminder,
  type MeetingReminderDue,
} from "./reminders";
export { buildCommitteeDigest, sendCommitteeDigest } from "./digest";

// A member's standing, recomputed from their approved Submissions.
export { recomputeStanding } from "./standing";

// The refusal taxonomy: the wrong person, or the wrong moment.
export {
  LifecycleError,
  ValidationError,
  AuthorizationError,
  StateError,
  UnboundError,
  isLifecycleError,
} from "./errors";

// The module's own test seam. Not for callers: swapping the notifier changes
// who gets told, which is the one consequence a test cannot read back out of
// the database.
export { setNotifier, resetNotifier, type Notifier } from "./consequences";

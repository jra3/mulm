import { MIDDLE_STATES, SubmissionState } from "./state";
import { AuthorizationError, StateError, UnboundError } from "./errors";

/**
 * The transition table: which moves are legal from which states, and for whom.
 *
 * This is the single statement of the rules. Every transition function checks
 * itself against its row here, so a new surface cannot invent its own.
 *
 * | Move                    | From                                    | To                  | Actor              |
 * |-------------------------|-----------------------------------------|---------------------|--------------------|
 * | saveDraft               | draft                                   | draft               | member             |
 * | submit                  | draft                                   | pendingWitness      | member             |
 * | saveChanges             | the three middle states                 | same, or            | member             |
 * |                         |                                         | pendingWitness if   |                    |
 * |                         |                                         | it was witnessed    |                    |
 * | returnToDraft           | the three middle states                 | draft               | member             |
 * | confirmWitness          | pendingWitness, bound or recording a    | waitingPeriod (or   | committee, not the submitter |
 * |                         | Species (takes the Species or a new one | inApprovalQueue, if |                    |
 * |                         | to create, base points and bonuses;     | the clock has run), |                    |
 * |                         | rebinds and adopts the Species'         | points set; the     |                    |
 * |                         | classification as needed)               | member emailed them |                    |
 * | bindSpecies             | pendingWitness, no changes requested    | same, bound         | committee, not the submitter |
 * | adoptSpeciesClassification | pendingWitness, bound, no changes    | same, agreeing      | committee, not the submitter |
 * |                         | requested                               |                     |                    |
 * | requestChanges          | the three middle states                 | same, flag set      | committee          |
 * | resubmit                | the three middle states                 | as saveChanges,     | member             |
 * |                         |                                         | flag cleared        |                    |
 * | approve                 | inApprovalQueue, bound, with points     | approved: first-    | committee, not the submitter |
 * |                         | (takes the total the approver saw, and  | time computed, the  |                    |
 * |                         | refuses if the row awards another)      | points awarded      |                    |
 * | correctPoints           | waitingPeriod, inApprovalQueue or       | same (or the        | committee, not the submitter |
 * |                         | approved, bound or naming a Species     | waiting period, if  |                    |
 * |                         | (takes the Species or a new one to      | the new Species'    |                    |
 * |                         | create, base points and bonuses, first- | clock has not run); |                    |
 * |                         | time on Approved only, and a reason)    | Witness untouched   |                    |
 * | editApprovedDetails     | approved (takes the member's details:   | approved, details   | committee, not the submitter |
 * |                         | tank, foods, dates, supplements; never  | changed; Species,   |                    |
 * |                         | the Species or points, and a reason)    | points and Witness  |                    |
 * |                         |                                         | untouched           |                    |
 * | deleteSubmission        | draft (member); draft .. inApprovalQueue (committee) | gone   | member or committee|
 *
 * Every member save of a submitted Submission (submit, saveChanges, resubmit)
 * voids a confirmed Witness (ADR-0001; `voidWitness` in transitions.ts) and
 * clears the points it set (ADR-0003). saveDraft does not, and committee
 * moves never do: binding a Species is the committee's, not an edit of the
 * member's form.
 *
 * A member save also clears a binding the saved form no longer agrees with
 * (CONTEXT.md, Bound; `bindingAfterSave` in transitions.ts).
 *
 * The thirteenth move is the clock: the waiting period elapsing carries a
 * Submission from waitingPeriod into the approval queue with nobody
 * performing anything. It is computed in `state.ts` rather than listed here.
 * The member does nothing to enter the queue; they bring the fry, plants or
 * coral to a meeting, and a committee member approves it there.
 *
 * One write happened outside the table, once: migration 066 (#524) sent
 * every Submission witnessed before points moved to the Witness back to
 * pendingWitness, as a void would, with a note naming the original witness
 * (`rewitness.ts`). From there the rows above apply as to any other.
 */

/** Who is asking. A committee member is a member with `is_admin`. */
export type Actor = "member" | "committee";

export type MoveId =
  | "saveDraft"
  | "submit"
  | "saveChanges"
  | "returnToDraft"
  | "confirmWitness"
  | "bindSpecies"
  | "adoptSpeciesClassification"
  | "requestChanges"
  | "resubmit"
  | "approve"
  | "correctPoints"
  | "editApprovedDetails"
  | "deleteSubmission";

export type MoveDefinition = {
  /** What a refusal calls this move. */
  readonly id: MoveId;
  /** The states the move is legal from, for any actor not named in `fromByActor`. */
  readonly from: readonly SubmissionState[];
  /** Narrower `from` lists for particular actors. */
  readonly fromByActor?: Partial<Record<Actor, readonly SubmissionState[]>>;
  /** Who may perform it at all. */
  readonly actors: readonly Actor[];
  /** Illegal while the committee has changes outstanding. */
  readonly requiresNoChangesPending?: boolean;
  /** Legal only while the committee has changes outstanding. */
  readonly requiresChangesPending?: boolean;
  /** A member acting on this move must own the Submission. */
  readonly ownerOnly?: boolean;
  /** The submitter may never perform it, committee member or not. */
  readonly neverSubmitter?: boolean;
  /** Legal only on a Submission bound to a Species. */
  readonly requiresBound?: boolean;
};

const MEMBER_ONLY: readonly Actor[] = ["member"];
const COMMITTEE_ONLY: readonly Actor[] = ["committee"];
const EITHER: readonly Actor[] = ["member", "committee"];

export const moves = {
  /**
   * A Submission's contents are the member's own. The committee changes a
   * Submission by asking for changes, not by typing into it - the exceptions
   * being a correction to the Species and points it set itself, and a details
   * edit on an Approved Submission, which the member can no longer edit; both
   * carry a stated reason and go on the record.
   *
   * Filing a new Submission on a member's behalf is a different matter and
   * still allowed: creation is not a move from a state, so it is guarded in
   * `createSubmission` rather than here.
   */
  saveDraft: {
    id: "saveDraft",
    from: ["draft"],
    actors: MEMBER_ONLY,
    ownerOnly: true,
  },

  submit: {
    id: "submit",
    from: ["draft"],
    actors: MEMBER_ONLY,
    ownerOnly: true,
  },

  /**
   * Editing in place. The submission date is kept, but a confirmed Witness is
   * voided (ADR-0001), so a witnessed Submission goes back to Pending Witness.
   */
  saveChanges: {
    id: "saveChanges",
    from: MIDDLE_STATES,
    actors: MEMBER_ONLY,
    ownerOnly: true,
  },

  /**
   * Withdrawing, as an explicit named action rather than a side effect of
   * editing. Legal from anywhere short of Approved, the approval queue
   * included: there is no queue entry to leave first, since the clock put it
   * there.
   */
  returnToDraft: {
    id: "returnToDraft",
    from: MIDDLE_STATES,
    actors: MEMBER_ONLY,
    ownerOnly: true,
  },

  /**
   * The Witness sets the Species and the points (ADR-0003): the base points
   * and every bonus but first-time, which approval computes. Nothing enters
   * the waiting period without a Species, so the Submission must be bound,
   * by the member's pick, by `bindSpecies`, or by the Species the confirm
   * itself carries. The confirm also gives the Submission its Species' type
   * and class where they disagree, so there is no mismatch left to refuse.
   */
  confirmWitness: {
    id: "confirmWitness",
    from: ["pendingWitness"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
  },

  /**
   * Bind (or rebind) the Submission to a Species from the catalogue - the
   * witness's job, recorded in the changelog. Never the submitter, as with the
   * Witness it prepares. Only while a Witness is awaited: once it is
   * confirmed the Species and the points were set together, so the Species
   * changes only together with the points, through `correctPoints`, with a
   * stated reason (#528).
   */
  bindSpecies: {
    id: "bindSpecies",
    from: ["pendingWitness"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
  },

  /**
   * The witness's one-click answer to a mismatch: the Submission takes the
   * bound Species' Species type and Program class. A committee move on the
   * changelog, like binding, and like binding legal only while a Witness is
   * awaited; the confirm adopts the classification itself, and after it a
   * correction does (#528).
   */
  adoptSpeciesClassification: {
    id: "adoptSpeciesClassification",
    from: ["pendingWitness"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
  },

  requestChanges: {
    id: "requestChanges",
    from: MIDDLE_STATES,
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
  },

  resubmit: {
    id: "resubmit",
    from: MIDDLE_STATES,
    actors: MEMBER_ONLY,
    requiresChangesPending: true,
    ownerOnly: true,
  },

  /**
   * One button at the meeting (ADR-0003): approval records that the member
   * brought the fry, plants or coral, and awards the points the Witness set.
   * It takes no form; the only thing it decides is first-time, counted in
   * its own transaction so the first click wins, and it refuses when the
   * total it would award is not the one the approver was shown.
   *
   * Never the submitter, as with the Witness: awarding yourself points is the
   * same conflict as inspecting your own fry. Never on a Submission bound to
   * no Species, so Points are never awarded to no Species; there is no
   * binding at approval. After migration 066 a witnessed Submission is always
   * bound and always carries points, so these refusals guard rows written
   * around the lifecycle.
   */
  approve: {
    id: "approve",
    from: ["inApprovalQueue"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
  },

  /**
   * The committee puts the Species and the points right, from the Witness on
   * (#528): in the waiting period, in the approval queue and on an Approved
   * Submission, which is how it acts on a member's dispute and on a bonus
   * earned after approval. It carries the Species and the points together,
   * needs a stated reason, goes on the changelog, and leaves the Witness in
   * place. Never the submitter, as with the Witness and approval. Bound as
   * the confirm is: the Submission's Species, or the one the correction
   * names, so a correction never leaves a Submission with points and no
   * Species. The only movement out of Approved, which is otherwise terminal.
   */
  correctPoints: {
    id: "correctPoints",
    from: ["waitingPeriod", "inApprovalQueue", "approved"],
    actors: COMMITTEE_ONLY,
    neverSubmitter: true,
    requiresBound: true,
  },

  /**
   * The committee puts the member's own details right on an Approved
   * Submission (#529): the tank, the foods, the dates and the like, which the
   * member can no longer edit since Approved is terminal. Never the Species
   * or the points, which are `correctPoints`'s and carry consequences this
   * move does not: a details edit needs a stated reason and goes on the
   * changelog, but tells nobody and recomputes nothing, since nothing it
   * changes counts toward a standing. Never the submitter, as with every
   * committee move on a member's record.
   */
  editApprovedDetails: {
    id: "editApprovedDetails",
    from: ["approved"],
    actors: COMMITTEE_ONLY,
    neverSubmitter: true,
  },

  /**
   * Members delete only their own Drafts, so one confirmation dialog cannot
   * destroy an inspection a committee member has already performed. The
   * committee deletes duplicates and junk anywhere short of Approved.
   */
  deleteSubmission: {
    id: "deleteSubmission",
    from: ["draft", ...MIDDLE_STATES],
    fromByActor: { member: ["draft"] },
    actors: EITHER,
    ownerOnly: true,
  },
} as const satisfies Record<MoveId, MoveDefinition>;

/** What the guard is told about the Submission and the caller. */
export type MoveContext = {
  readonly state: SubmissionState;
  readonly changesPending: boolean;
  readonly actor: Actor;
  /** The caller's member id, for the refusal's context. */
  readonly actorId: number;
  /** Whether the caller owns the Submission. */
  readonly isOwner: boolean;
  /** Whether the Submission is bound to a Species. */
  readonly bound: boolean;
};

/** The states `move` is legal from for this actor. */
export function legalFrom(move: MoveDefinition, actor: Actor): readonly SubmissionState[] {
  return move.fromByActor?.[actor] ?? move.from;
}

/**
 * Whether a move is legal right now - the question the Portal asks before it
 * shows a button, so a member is never offered an action that will refuse them.
 */
export function canMove(move: MoveDefinition, context: MoveContext): boolean {
  try {
    assertMoveIsLegal(move, context);
    return true;
  } catch {
    return false;
  }
}

/**
 * The guard every transition runs. Authorization is checked before state, so a
 * refusal names the wrong person before it names the wrong moment.
 *
 * Independence is checked first, and deliberately: a committee member acting on
 * their own Submission wears the member's hat, so the actor check below would
 * otherwise refuse them with "only the committee may do this" - which is both
 * wrong and confusing, because they are on the committee.
 */
export function assertMoveIsLegal(move: MoveDefinition, context: MoveContext): void {
  const { state, changesPending, actor, actorId, isOwner, bound } = context;

  if (move.neverSubmitter && isOwner) {
    throw new AuthorizationError(
      `You cannot ${describe(move.id, "your own submission")}`,
      actorId,
      move.id
    );
  }

  if (!move.actors.includes(actor)) {
    throw new AuthorizationError(
      `Only the ${move.actors.join(" or ")} may ${describe(move.id, "this submission")}`,
      actorId,
      move.id
    );
  }

  if (move.ownerOnly && actor === "member" && !isOwner) {
    throw new AuthorizationError(
      "Cannot modify another member's submission",
      actorId,
      move.id
    );
  }

  const from = legalFrom(move, actor);
  if (!from.includes(state)) {
    throw new StateError(
      `Cannot ${describe(move.id, `a submission that is ${label(state)}`)}`,
      from.join(" or "),
      state
    );
  }

  if (move.requiresNoChangesPending && changesPending) {
    throw new StateError(
      `Cannot ${describe(move.id, "this submission")} while requested changes are outstanding`,
      "no changes outstanding",
      "changes requested"
    );
  }

  if (move.requiresChangesPending && !changesPending) {
    throw new StateError(
      `Cannot ${describe(move.id, "this submission")} when no changes have been requested`,
      "changes requested",
      "no changes outstanding"
    );
  }

  if (move.requiresBound && !bound) {
    throw new UnboundError(`Bind this Submission to a Species before you ${describeOnBound(move.id)}`, move.id);
  }
}

/**
 * How a move is named in a refusal: the whole predicate, with `object` - the
 * Submission as the sentence refers to it - where the move puts it, so every
 * refusal reads as a sentence ("return this submission to draft", "confirm
 * the witness on a submission that is approved").
 */
function describe(id: MoveId, object: string): string {
  switch (id) {
    case "saveDraft":
      return `save a draft of ${object}`;
    case "submit":
      return `submit ${object}`;
    case "saveChanges":
      return `save changes to ${object}`;
    case "returnToDraft":
      return `return ${object} to draft`;
    case "confirmWitness":
      return `confirm the witness on ${object}`;
    case "bindSpecies":
      return `choose the Species of ${object}`;
    case "adoptSpeciesClassification":
      return `give ${object} its Species' type and class`;
    case "requestChanges":
      return `request changes on ${object}`;
    case "resubmit":
      return `resubmit ${object}`;
    case "approve":
      return `approve ${object}`;
    case "correctPoints":
      return `correct the points on ${object}`;
    case "editApprovedDetails":
      return `edit the details of ${object}`;
    case "deleteSubmission":
      return `delete ${object}`;
  }
}

/**
 * How a move that needs a bound Submission is named after "before you", in
 * the refusal `requiresBound` raises: "confirm its Witness" reads better
 * than `describe`'s "confirm the witness on it".
 */
function describeOnBound(id: MoveId): string {
  switch (id) {
    case "confirmWitness":
      return "confirm its Witness";
    case "approve":
      return "approve it";
    case "correctPoints":
      return "correct its points";
    default:
      return describe(id, "it");
  }
}

/** How a state is named in a refusal. */
export function label(state: SubmissionState): string {
  switch (state) {
    case "draft":
      return "a draft";
    case "pendingWitness":
      return "pending screening";
    case "waitingPeriod":
      return "in its waiting period";
    case "inApprovalQueue":
      return "in the approval queue";
    case "approved":
      return "approved";
  }
}

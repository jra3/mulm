import { MIDDLE_STATES, SubmissionState } from "./state";
import { AuthorizationError, MismatchError, StateError, UnboundError } from "./errors";

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
 * | saveChanges             | the four middle states                  | same, or            | member             |
 * |                         |                                         | pendingWitness if   |                    |
 * |                         |                                         | it was witnessed    |                    |
 * | returnToDraft           | pendingWitness .. awaitingFinalSubmission| draft              | member             |
 * | confirmWitness          | pendingWitness, bound, type and class   | waitingPeriod       | committee, not the submitter |
 * |                         | agreeing with the Species               |                     |                    |
 * | bindSpecies             | the four middle states, no changes      | same, bound         | committee, not the submitter |
 * |                         | requested                               |                     |                    |
 * | adoptSpeciesClassification | the four middle states, bound, no    | same, agreeing      | committee, not the submitter |
 * |                         | changes requested                       |                     |                    |
 * | enterApprovalQueue      | awaitingFinalSubmission                 | inApprovalQueue     | member or committee|
 * | removeFromQueue         | inApprovalQueue                         | awaitingFinalSubmission | member or committee |
 * | requestChanges          | the four middle states                  | same, flag set      | committee          |
 * | resubmit                | the four middle states                  | as saveChanges,     | member             |
 * |                         |                                         | flag cleared        |                    |
 * | approve                 | inApprovalQueue, bound to a Species     | approved            | committee          |
 * | correctPoints           | approved                                | approved            | committee          |
 * | deleteSubmission        | draft (member); draft .. inApprovalQueue (committee) | gone   | member or committee|
 *
 * Every member save of a submitted Submission (submit, saveChanges, resubmit)
 * voids a confirmed Witness (ADR-0001; `voidWitness` in transitions.ts).
 * saveDraft does not, and committee moves never do: binding a Species is the
 * committee's, not an edit of the member's form.
 *
 * A member save also clears a binding the saved form no longer agrees with
 * (CONTEXT.md, Bound; `bindingAfterSave` in transitions.ts).
 *
 * The fifteenth move is the clock: the waiting period elapsing carries a
 * Submission from waitingPeriod to awaitingFinalSubmission with nobody
 * performing anything. It is computed in `state.ts` rather than listed here.
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
  | "enterApprovalQueue"
  | "removeFromQueue"
  | "requestChanges"
  | "resubmit"
  | "approve"
  | "correctPoints"
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
  /**
   * Legal only while the Submission's Species type and Program class agree
   * with the bound Species'.
   */
  readonly requiresAgreeingClassification?: boolean;
};

const MEMBER_ONLY: readonly Actor[] = ["member"];
const COMMITTEE_ONLY: readonly Actor[] = ["committee"];
const EITHER: readonly Actor[] = ["member", "committee"];

export const moves = {
  /**
   * A Submission's contents are the member's own. The committee changes a
   * Submission by asking for changes, not by typing into it - the one
   * exception being a correction to an Approved Submission, which carries a
   * stated reason and goes on the record.
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
   * editing. Not legal from the approval queue: a member walks it back one
   * named step at a time, so leaving the queue comes first.
   */
  returnToDraft: {
    id: "returnToDraft",
    from: ["pendingWitness", "waitingPeriod", "awaitingFinalSubmission"],
    actors: MEMBER_ONLY,
    ownerOnly: true,
  },

  /** Nothing enters the waiting period without a Species: the witness binds it first. */
  confirmWitness: {
    id: "confirmWitness",
    from: ["pendingWitness"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
    requiresAgreeingClassification: true,
  },

  /**
   * Bind (or rebind) the Submission to a Species from the catalogue - the
   * witness's job, recorded in the changelog. Never the submitter, as with the
   * Witness it prepares. Not on an Approved Submission: that is a Points
   * correction, with a stated reason.
   */
  bindSpecies: {
    id: "bindSpecies",
    from: MIDDLE_STATES,
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
  },

  /**
   * The witness's one-click answer to a mismatch: the Submission takes the
   * bound Species' Species type and Program class. A committee move on the
   * changelog, like binding, so it leaves a confirmed Witness in place.
   */
  adoptSpeciesClassification: {
    id: "adoptSpeciesClassification",
    from: MIDDLE_STATES,
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
  },

  enterApprovalQueue: {
    id: "enterApprovalQueue",
    from: ["awaitingFinalSubmission"],
    actors: EITHER,
    requiresNoChangesPending: true,
    ownerOnly: true,
  },

  removeFromQueue: {
    id: "removeFromQueue",
    from: ["inApprovalQueue"],
    actors: EITHER,
    ownerOnly: true,
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
   * Never the submitter, as with the Witness: awarding yourself points is the
   * same conflict as inspecting your own fry. The Portal already hid the
   * approval panel from a Submission's owner; this makes it a rule. Never on a
   * Submission bound to no Species, so Points are never awarded to no Species;
   * there is no binding at approval, so one past its Witness unbound is fixed
   * by hand.
   */
  approve: {
    id: "approve",
    from: ["inApprovalQueue"],
    actors: COMMITTEE_ONLY,
    requiresNoChangesPending: true,
    neverSubmitter: true,
    requiresBound: true,
  },

  /** The only movement out of Approved. Approved is otherwise terminal. */
  correctPoints: {
    id: "correctPoints",
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
  /**
   * Whether the Submission's Species type and Program class agree with the
   * bound Species'. Undefined when unbound or not looked up; only a move that
   * `requiresAgreeingClassification` needs it.
   */
  readonly classificationAgrees?: boolean;
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
  const { state, changesPending, actor, actorId, isOwner, bound, classificationAgrees } = context;

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

  if (move.requiresAgreeingClassification && classificationAgrees === false) {
    throw new MismatchError(
      "This Submission's Species type or Program class disagrees with its Species. " +
        `Adopt the Species' values, rebind it, or request changes before you ${describeOnBound(move.id)}`,
      move.id
    );
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
    case "enterApprovalQueue":
      return `queue ${object} for approval`;
    case "removeFromQueue":
      return `remove ${object} from the approval queue`;
    case "requestChanges":
      return `request changes on ${object}`;
    case "resubmit":
      return `resubmit ${object}`;
    case "approve":
      return `approve ${object}`;
    case "correctPoints":
      return `correct the points on ${object}`;
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
    case "awaitingFinalSubmission":
      return "awaiting confirmation it was brought to a meeting";
    case "inApprovalQueue":
      return "in the approval queue";
    case "approved":
      return "approved";
  }
}

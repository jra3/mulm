import type { Database } from "sqlite";
import { withTransaction } from "@/db/conn";
import {
  createSubmissionRow,
  deleteSubmissionRow,
  formToRow,
  getSubmissionById,
  programOfSpeciesType,
  setSubmissionSupplements,
  Submission,
} from "@/db/submissions";
import { getMember, MemberRecord } from "@/db/members";
import { addNote } from "@/db/submission_notes";
import { recordActivity } from "@/db/activity";
import type { FormValues } from "@/forms/submission";
import type { ApprovalFormValues } from "@/forms/approval";
import type { Program } from "@/levelManager";
import { isProgramType } from "@/programs";
import { addName, canonicalName, checkFormAgreement, findSpeciesById, type NameKind } from "@/species";
import { logger } from "@/utils/logger";
import { AuthorizationError, ValidationError, StateError } from "./errors";
import { deriveState, hasChangesRequested } from "./state";
import { assertMoveIsLegal, Actor, MoveDefinition, moves } from "./table";
import { notifier } from "./consequences";
import { recomputeStanding } from "./standing";

/**
 * The transitions: one exported function per move in the table.
 *
 * Not a single `apply(action, ...)` dispatcher. The payloads differ and each
 * route performs exactly one move, so a dispatcher would take a union and
 * immediately re-branch on it - a large interface disguised as a small one,
 * with the payload unchecked at the call site.
 *
 * Every one of them follows the same shape:
 *
 *   1. read the row and derive its state,
 *   2. check the move against the table - the legality guard,
 *   3. write, with a conditional WHERE - the concurrency check, which guards a
 *      different thing (the row changing between read and write) and is not a
 *      substitute for the guard above,
 *   4. and only once that has committed, run the consequences.
 *
 * Consequences run after the commit, so a transition that is refused cannot
 * still have sent the member a letter about it.
 */

/** Who is performing a move. */
export type Caller = {
  /** The acting member's id. */
  id: number;
  /** Whether they hold committee (admin) rights. */
  isAdmin: boolean;
};

/** The columns every guard reads. */
const STATE_COLUMNS = `id, member_id, program, submitted_on, approved_on,
   witness_verification_status, final_submission_on, changes_requested_on,
   reproduction_date, species_type, species_class, species_id`;

/**
 * Which hat the caller is wearing.
 *
 * A committee member acting on their own Submission is a member: they take it
 * back to Draft and delete it under the same rules as anyone else, and the
 * moves that need independence refuse them by name.
 */
function actorFor(caller: Caller, submission: Pick<Submission, "member_id">): Actor {
  if (submission.member_id === caller.id) {
    return "member";
  }
  return caller.isAdmin ? "committee" : "member";
}

/** Read a row for its guard, or refuse because there is nothing to act on. */
async function readForGuard(db: Database, submissionId: number): Promise<Submission> {
  const stmt = await db.prepare(`SELECT ${STATE_COLUMNS} FROM submissions WHERE id = ?`);
  const rows: Submission[] = await stmt.all(submissionId);
  await stmt.finalize();

  if (!rows[0]) {
    throw new ValidationError("Submission not found", "submissionId", submissionId);
  }
  return rows[0];
}

/** Read the row, check the move against the table, and hand back the row. */
async function guard(
  db: Database,
  move: MoveDefinition,
  caller: Caller,
  submissionId: number
): Promise<{ submission: Submission; actor: Actor }> {
  const submission = await readForGuard(db, submissionId);
  const actor = actorFor(caller, submission);

  // Asked of the catalogue only for a move that needs it. A bound Species
  // the catalogue no longer has agrees with nothing.
  const classificationAgrees =
    move.requiresAgreeingClassification && submission.species_id != null
      ? ((await checkFormAgreement(submission.species_id, submission))?.classificationAgrees ?? false)
      : undefined;

  assertMoveIsLegal(move, {
    state: deriveState(submission),
    changesPending: hasChangesRequested(submission),
    actor,
    actorId: caller.id,
    isOwner: submission.member_id === caller.id,
    bound: submission.species_id != null,
    classificationAgrees,
  });

  return { submission, actor };
}

/** The concurrency check: the row moved under us between read and write. */
function assertWriteLanded(changes: number, move: MoveDefinition): void {
  if (changes === 0) {
    throw new StateError("Submission state changed during operation", move.id, "unknown");
  }
}

async function runUpdate(
  db: Database,
  sql: string,
  params: unknown[],
  move: MoveDefinition
): Promise<void> {
  const stmt = await db.prepare(sql);
  try {
    const result = await stmt.run(...params);
    assertWriteLanded(result.changes ?? 0, move);
  } finally {
    await stmt.finalize();
  }
}

/**
 * A binding holds only while the Submission's spellings, Species type and
 * Program class agree with the Species (CONTEXT.md, Bound): saving a form that
 * no longer agrees clears it. A spelling agrees when it is blank or a Name of
 * the Species (`checkFormAgreement`). Only member saves ask this; committee
 * moves never unbind.
 */
async function bindingAfterSave(
  submission: Pick<Submission, "species_id">,
  form: FormValues
): Promise<{ species_id?: null }> {
  if (submission.species_id == null) return {};
  const agreement = await checkFormAgreement(submission.species_id, form);
  return agreement?.agrees ? {} : { species_id: null };
}

/**
 * Write a member's form over the Submission's content columns, leaving every
 * lifecycle column alone - except the binding, which the form may clear
 * (`bindingAfterSave`).
 */
async function writeContent(
  db: Database,
  submission: Pick<Submission, "id" | "member_id" | "species_id">,
  form: FormValues,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const submissionId = submission.id;
  const row = {
    ...formToRow(submission.member_id, form),
    ...(await bindingAfterSave(submission, form)),
    ...extra,
  };
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const setClause = entries.map(([field]) => `${field} = ?`).join(", ");

  const stmt = await db.prepare(`UPDATE submissions SET ${setClause} WHERE id = ?`);
  try {
    await stmt.run(...entries.map(([, value]) => value), submissionId);
  } finally {
    await stmt.finalize();
  }
}

/**
 * Void a confirmed Witness: ADR-0001's rule, stated once.
 *
 * A Witness attests to the fry and to the form, so every member save of a
 * submitted Submission voids it and the Submission awaits a Witness again. One
 * rule, no field list and no diff: saving is the edit, even if nothing changed.
 * The approval queue entry goes too, because nothing is queued for approval
 * unwitnessed; the member queues it again once it has been re-witnessed.
 *
 * Only member saves call this. Committee moves, including a Points correction
 * to an Approved Submission, never touch the Witness.
 */
async function voidWitness(db: Database, submissionId: number, move: MoveDefinition): Promise<void> {
  await runUpdate(
    db,
    `UPDATE submissions SET
       witness_verification_status = 'pending',
       witnessed_by = NULL,
       witnessed_on = NULL,
       final_submission_on = NULL
     WHERE id = ? AND submitted_on IS NOT NULL AND approved_on IS NULL`,
    [submissionId],
    move
  );
}

/**
 * Put a committee change on the Submission's changelog: the structured
 * `admin_edit` note the review page renders as field, old and new.
 */
async function recordAdminEdit(
  submissionId: number,
  caller: Caller,
  changes: Change[],
  reason: string
): Promise<void> {
  await addNote(
    submissionId,
    caller.id,
    JSON.stringify({
      type: "admin_edit",
      changes,
      reason,
      timestamp: new Date().toISOString(),
      admin_id: caller.id,
    })
  );
}

/** The supplements a form carries, as the normalized table wants them. */
export function supplementsFromForm(form: FormValues): { type: string; regimen: string }[] {
  const types = form.supplement_type;
  const regimens = form.supplement_regimen;
  if (!Array.isArray(types) || !Array.isArray(regimens)) {
    return [];
  }

  const supplements: { type: string; regimen: string }[] = [];
  for (let i = 0; i < Math.max(types.length, regimens.length); i++) {
    const type = types[i] || "";
    const regimen = regimens[i] || "";
    if (type || regimen) {
      supplements.push({ type, regimen });
    }
  }
  return supplements;
}

// ---------------------------------------------------------------------------
// Creating a Submission
// ---------------------------------------------------------------------------

/**
 * Create a Submission, as a Draft or submitted outright.
 *
 * Not a move: there is no prior state to be legal from. The only guard is that
 * a member may create only for themselves, while a committee member may create
 * on another member's behalf.
 */
export async function createSubmission(
  caller: Caller,
  memberId: number,
  form: FormValues,
  options: { submit: boolean }
): Promise<number> {
  if (memberId !== caller.id && !caller.isAdmin) {
    throw new AuthorizationError(
      "Not authorized to submit for other members",
      caller.id,
      "createSubmission"
    );
  }

  const submittedOn = options.submit ? new Date().toISOString() : undefined;
  const submissionId = await createSubmissionRow(
    {
      ...formToRow(memberId, form),
      submitted_on: submittedOn,
      witness_verification_status: options.submit ? "pending" : undefined,
    },
    supplementsFromForm(form)
  );

  if (options.submit) {
    await announceSubmission(submissionId, memberId);
  }

  return submissionId;
}

/** Tell the member their Submission arrived. The committee learns from the digest. */
async function announceSubmission(submissionId: number, memberId: number): Promise<void> {
  const [submission, member] = await Promise.all([getSubmissionById(submissionId), getMember(memberId)]);
  if (submission && member) {
    await notifier().submissionReceived(submission, member);
  }
}

// ---------------------------------------------------------------------------
// Member moves
// ---------------------------------------------------------------------------

/** Save a Draft. Nothing moves and nobody is told. */
export async function saveDraft(
  caller: Caller,
  submissionId: number,
  form: FormValues
): Promise<void> {
  const memberId = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.saveDraft, caller, submissionId);
    await writeContent(db, submission, form);
    return submission.member_id;
  });

  await setSubmissionSupplements(submissionId, supplementsFromForm(form));
  logger.info("Draft saved", { submissionId, memberId, by: caller.id });
}

/**
 * Submit a Draft to the committee.
 *
 * Always lands in Pending Witness: submitting saves the form, which voids a
 * Witness kept from before Return to Draft (see `voidWitness`).
 */
export async function submit(
  caller: Caller,
  submissionId: number,
  form: FormValues
): Promise<void> {
  const memberId = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.submit, caller, submissionId);

    await writeContent(db, submission, form, {
      // Submitting is the member's answer to a request for changes, so the
      // flag clears here: work arriving in a committee queue must never also
      // be marked as waiting on the member.
      changes_requested_on: null,
      changes_requested_by: null,
      changes_requested_reason: null,
    });

    await runUpdate(
      db,
      `UPDATE submissions SET submitted_on = ? WHERE id = ? AND submitted_on IS NULL`,
      [new Date().toISOString(), submissionId],
      moves.submit
    );
    await voidWitness(db, submissionId, moves.submit);

    return submission.member_id;
  });

  await setSubmissionSupplements(submissionId, supplementsFromForm(form));
  await announceSubmission(submissionId, memberId);
}

/**
 * Edit a submitted Submission in place.
 *
 * It keeps its original submission date, but the save voids a confirmed
 * Witness (see `voidWitness`): a witnessed Submission goes back to Pending
 * Witness and reappears in the witness queue. Nobody is emailed - the form
 * warned the member, and the committee's witness queue and daily digest are
 * the notice - so fixing a water-hardness figure does not put a second copy of
 * the Submission in three committee members' inboxes.
 */
export async function saveChanges(
  caller: Caller,
  submissionId: number,
  form: FormValues
): Promise<void> {
  await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.saveChanges, caller, submissionId);
    await writeContent(db, submission, form);
    await voidWitness(db, submissionId, moves.saveChanges);
  });

  await setSubmissionSupplements(submissionId, supplementsFromForm(form));
  logger.info("Submission edited in place", { submissionId, by: caller.id });
}

/**
 * Withdraw a Submission to Draft.
 *
 * Explicit, named, and the member's own choice - not a side effect of opening
 * the edit form. Withdrawing is not itself an edit, so the confirmed Witness
 * stays on the row until the member submits again - and submitting saves the
 * form, which voids it.
 */
export async function returnToDraft(caller: Caller, submissionId: number): Promise<void> {
  await withTransaction(async (db) => {
    await guard(db, moves.returnToDraft, caller, submissionId);
    await runUpdate(
      db,
      `UPDATE submissions SET submitted_on = NULL
         WHERE id = ? AND submitted_on IS NOT NULL AND approved_on IS NULL`,
      [submissionId],
      moves.returnToDraft
    );
  });

  logger.info("Submission returned to draft", { submissionId, by: caller.id });
}

/**
 * Answer a request for changes.
 *
 * The flag clears and the submission date is kept, so responding to the
 * committee does not restart the claim. The answer is a save, though, so it
 * voids a confirmed Witness (see `voidWitness`).
 */
export async function resubmit(
  caller: Caller,
  submissionId: number,
  form: FormValues
): Promise<void> {
  await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.resubmit, caller, submissionId);
    await writeContent(db, submission, form);
    await voidWitness(db, submissionId, moves.resubmit);
    await runUpdate(
      db,
      `UPDATE submissions SET
         changes_requested_on = NULL,
         changes_requested_by = NULL,
         changes_requested_reason = NULL
       WHERE id = ? AND changes_requested_on IS NOT NULL`,
      [submissionId],
      moves.resubmit
    );
  });

  await setSubmissionSupplements(submissionId, supplementsFromForm(form));
  logger.info("Submission resubmitted after changes requested", { submissionId, by: caller.id });
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/**
 * Confirm the Witness: a committee member has inspected the fry, and the
 * waiting period starts. The spellings the witness chose (`namesToAdd`) are
 * added to the bound Species as Names in the same transaction, so a refused
 * confirmation adds none.
 *
 * Never the submitter, so the independence of the first gate is enforced
 * rather than trusted. Refused on a Submission bound to no Species, so nothing
 * enters the waiting period without one: the witness binds it first
 * (`bindSpecies`).
 */
export async function confirmWitness(
  caller: Caller,
  submissionId: number,
  namesToAdd: NamesToAdd = {}
): Promise<void> {
  const { memberId, added } = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.confirmWitness, caller, submissionId);
    await runUpdate(
      db,
      `UPDATE submissions SET
         witnessed_by = ?,
         witnessed_on = ?,
         witness_verification_status = 'confirmed'
       WHERE id = ? AND witness_verification_status != 'confirmed' AND approved_on IS NULL`,
      [caller.id, new Date().toISOString(), submissionId],
      moves.confirmWitness
    );
    const added = await addSpellingsAsNames(db, submissionId, submission.species_id!, namesToAdd);
    return { memberId: submission.member_id, added };
  });

  const [submission, member, witness] = await Promise.all([
    getSubmissionById(submissionId),
    getMember(memberId),
    getMember(caller.id),
  ]);
  if (submission && member && witness) {
    await notifier().witnessConfirmed(submission, member, witness);
  }

  logger.info("Witness confirmed", { submissionId, witnessedBy: caller.id, namesAdded: added });
}

/**
 * Which of the Submission's own spellings the witness chose to add to its
 * Species as Names: the witness panel offers the common spelling checked and
 * the Latin spelling unchecked.
 */
export type NamesToAdd = { common?: boolean; scientific?: boolean };

/**
 * Add the chosen spellings as Names of the Species, inside the Witness's
 * transaction - the one place a Submission's spellings become Names. A
 * spelling that is blank or already a Name of that kind (as
 * `checkFormAgreement` decides: whole, any case) is never added.
 * @returns the texts added, by kind
 */
async function addSpellingsAsNames(
  db: Database,
  submissionId: number,
  speciesId: number,
  namesToAdd: NamesToAdd
): Promise<Partial<Record<NameKind, string>>> {
  if (!namesToAdd.common && !namesToAdd.scientific) return {};

  const stmt = await db.prepare(
    "SELECT species_common_name, species_latin_name FROM submissions WHERE id = ?"
  );
  const spellings = await stmt.get<{ species_common_name: string; species_latin_name: string }>(submissionId);
  await stmt.finalize();
  if (!spellings) return {};

  const agreement = await checkFormAgreement(speciesId, spellings);
  const offered = {
    common: { spelling: spellings.species_common_name, agreement: agreement?.commonName },
    scientific: { spelling: spellings.species_latin_name, agreement: agreement?.latinName },
  } satisfies Record<NameKind, unknown>;

  const added: Partial<Record<NameKind, string>> = {};
  for (const kind of ["common", "scientific"] as const) {
    const { spelling, agreement: spellingAgreement } = offered[kind];
    if (namesToAdd[kind] && spellingAgreement === "not-a-name") {
      await addName(speciesId, kind, spelling);
      added[kind] = spelling;
    }
  }
  return added;
}

/**
 * Bind a Submission to a Species from the catalogue, or rebind it to another.
 *
 * A committee move - the witness's - so it does not void a confirmed Witness:
 * the member's form is untouched. It goes on the Submission's changelog, the
 * same record a Points correction writes. Binding to the Species it is
 * already bound to changes nothing and records nothing.
 */
export async function bindSpecies(caller: Caller, submissionId: number, speciesId: number): Promise<void> {
  const species = await findSpeciesById(speciesId);
  if (!species) {
    throw new ValidationError("Choose a Species that exists", "species_id", speciesId);
  }

  const { changed, previousId } = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.bindSpecies, caller, submissionId);
    if (submission.species_id === speciesId) {
      return { changed: false, previousId: submission.species_id };
    }
    await runUpdate(
      db,
      `UPDATE submissions SET species_id = ? WHERE id = ? AND approved_on IS NULL`,
      [speciesId, submissionId],
      moves.bindSpecies
    );
    return { changed: true, previousId: submission.species_id };
  });
  if (!changed) return;

  const previous = previousId == null ? undefined : await findSpeciesById(previousId);
  const change: Change = {
    field: "species",
    old: previous ? canonicalName(previous) : null,
    new: canonicalName(species),
  };
  await recordAdminEdit(submissionId, caller, [change], previousId == null ? "Bound to a Species" : "Rebound to another Species");

  logger.info("Submission bound to a Species", { submissionId, speciesId, previousId, by: caller.id });
}

/**
 * Give the Submission its bound Species' Species type and Program class - the
 * witness's one-click answer to a mismatch - and the Program that type
 * belongs to.
 *
 * A committee move like `bindSpecies`: on the changelog, and it leaves a
 * confirmed Witness in place. When the Submission already agrees it changes
 * nothing and records nothing.
 */
export async function adoptSpeciesClassification(caller: Caller, submissionId: number): Promise<void> {
  const changes = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.adoptSpeciesClassification, caller, submissionId);
    const species = await findSpeciesById(submission.species_id!);
    if (!species) {
      throw new ValidationError("The bound Species no longer exists", "species_id", submission.species_id);
    }

    const adopted = {
      species_type: species.species_type,
      species_class: species.program_class,
      program: programOfSpeciesType(species.species_type),
    };
    const diff = changesBetween(submission, adopted);
    if (diff.length === 0) return diff;

    await runUpdate(
      db,
      `UPDATE submissions SET species_type = ?, species_class = ?, program = ?
         WHERE id = ? AND approved_on IS NULL`,
      [adopted.species_type, adopted.species_class, adopted.program, submissionId],
      moves.adoptSpeciesClassification
    );
    return diff;
  });
  if (changes.length === 0) return;

  await recordAdminEdit(submissionId, caller, changes, "Adopted the Species' type and class");

  logger.info("Submission adopted its Species' classification", { submissionId, changes, by: caller.id });
}

/**
 * Enter the approval queue: the member (or a committee member on their behalf)
 * confirms the fry were brought to a meeting.
 */
export async function enterApprovalQueue(caller: Caller, submissionId: number): Promise<void> {
  await withTransaction(async (db) => {
    await guard(db, moves.enterApprovalQueue, caller, submissionId);
    await runUpdate(
      db,
      `UPDATE submissions SET final_submission_on = ?
         WHERE id = ? AND final_submission_on IS NULL AND approved_on IS NULL`,
      [new Date().toISOString(), submissionId],
      moves.enterApprovalQueue
    );
  });

  logger.info("Submission queued for approval", { submissionId, by: caller.id });
}

/** Take a Submission back out of the approval queue. */
export async function removeFromQueue(caller: Caller, submissionId: number): Promise<void> {
  await withTransaction(async (db) => {
    await guard(db, moves.removeFromQueue, caller, submissionId);
    await runUpdate(
      db,
      `UPDATE submissions SET final_submission_on = NULL
         WHERE id = ? AND final_submission_on IS NOT NULL AND approved_on IS NULL`,
      [submissionId],
      moves.removeFromQueue
    );
  });

  logger.info("Submission removed from approval queue", { submissionId, by: caller.id });
}

/**
 * Ask the member for changes, with the problems stated.
 *
 * This is the committee's refusal path, and it has a way back: the Submission
 * keeps its state and its Witness, leaves the committee's queues until the
 * member responds, and no committee action but Delete is legal meanwhile.
 */
export async function requestChanges(
  caller: Caller,
  submissionId: number,
  reason: string
): Promise<void> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ValidationError("Please describe what changes are needed", "reason", reason);
  }

  const memberId = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.requestChanges, caller, submissionId);
    await runUpdate(
      db,
      `UPDATE submissions SET
         changes_requested_on = ?,
         changes_requested_by = ?,
         changes_requested_reason = ?
       WHERE id = ? AND changes_requested_on IS NULL AND approved_on IS NULL`,
      [new Date().toISOString(), caller.id, trimmed, submissionId],
      moves.requestChanges
    );
    return submission.member_id;
  });

  const [submission, member] = await Promise.all([getSubmissionById(submissionId), getMember(memberId)]);
  if (submission && member) {
    await notifier().changesRequested(submission, member, trimmed);
  }

  logger.info("Changes requested", { submissionId, by: caller.id });
}

/**
 * Approve a bound Submission and award its Points.
 *
 * The only way Points are ever awarded, so there is one place to look when a
 * total is questioned - and the only transition that touches a member's
 * standing upward. The Species is the one the Submission is already bound to
 * (the witness bound it); approval is about Points and bonuses only, and is
 * refused on an unbound Submission.
 */
export async function approve(
  caller: Caller,
  submissionId: number,
  approval: ApprovalFormValues
): Promise<void> {
  const memberId = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.approve, caller, submissionId);

    const {
      points,
      article_points,
      first_time_species,
      flowered,
      sexual_reproduction,
      cares_species,
    } = approval;

    await runUpdate(
      db,
      `UPDATE submissions SET
         points = ?,
         article_points = ?,
         first_time_species = ?,
         cares_species = ?,
         flowered = ?,
         sexual_reproduction = ?,
         approved_by = ?,
         approved_on = ?
       WHERE id = ? AND approved_on IS NULL`,
      [
        points,
        article_points,
        first_time_species ? 1 : 0,
        cares_species ? 1 : 0,
        flowered ? 1 : 0,
        sexual_reproduction ? 1 : 0,
        caller.id,
        new Date().toISOString(),
        submissionId,
      ],
      moves.approve
    );

    return submission.member_id;
  });

  const [submission, member] = await Promise.all([getSubmissionById(submissionId), getMember(memberId)]);
  if (!submission || !member) {
    logger.error("Approved a submission whose row or member vanished", { submissionId });
    return;
  }

  await notifier().approved(submission, member);
  await announceApproval(submission, member);
  await recomputeStanding(member.id, programOf(submission));

  logger.info("Submission approved", { submissionId, by: caller.id, points: submission.points });
}

/**
 * Correct an Approved Submission, with a stated reason.
 *
 * The only movement out of Approved - a mistaken approval is put right rather
 * than deleted, and the correction goes on the record. It does not re-announce
 * the approval: the feed entry is updated in place, so fixing a mistake does
 * not put it back on the front page a second time. Nothing is emailed, because
 * the member's standing page already shows the truth. The Witness is left
 * alone (see `voidWitness`).
 *
 * Returns the fields that actually changed, which is also what the changelog
 * records.
 */
export async function correctPoints(
  caller: Caller,
  submissionId: number,
  updates: Record<string, unknown>,
  reason: string
): Promise<Change[]> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ValidationError("A correction needs a stated reason", "reason", reason);
  }

  const { memberId, changes } = await withTransaction(async (db) => {
    await guard(db, moves.correctPoints, caller, submissionId);

    // The full row, not just the guard's columns: the changelog diffs against
    // what is actually stored.
    const stmt = await db.prepare("SELECT * FROM submissions WHERE id = ?");
    const rows: Submission[] = await stmt.all(submissionId);
    await stmt.finalize();
    const before = rows[0];

    const diff = changesBetween(before, updates);
    if (diff.length === 0) {
      throw new ValidationError("No changes detected", "updates", updates);
    }

    const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
    const setClause = entries.map(([field]) => `${field} = ?`).join(", ");
    await runUpdate(
      db,
      `UPDATE submissions SET ${setClause} WHERE id = ? AND approved_on IS NOT NULL`,
      [...entries.map(([, value]) => value), submissionId],
      moves.correctPoints
    );

    return { memberId: before.member_id, changes: diff };
  });

  await recordAdminEdit(submissionId, caller, changes, trimmed);

  const [submission, member] = await Promise.all([getSubmissionById(submissionId), getMember(memberId)]);
  if (submission && member) {
    await announceApproval(submission, member);
    await recomputeStanding(member.id, programOf(submission));
  }

  logger.info("Approved submission corrected", { submissionId, by: caller.id, changes });
  return changes;
}

/**
 * Delete a Submission.
 *
 * Members delete only their own Drafts; the committee deletes duplicates and
 * junk anywhere short of Approved. An Approved Submission is undeletable for
 * everyone - correcting the Points is the only movement out of it - so a
 * witnessed, approved achievement cannot be erased along with its audit trail.
 *
 * Child rows go explicitly: every foreign key in this schema is unenforced in
 * production, so `ON DELETE CASCADE` would not fire.
 */
export async function deleteSubmission(caller: Caller, submissionId: number): Promise<void> {
  const { memberId, snapshot, byCommittee } = await withTransaction(async (db) => {
    const { submission, actor } = await guard(db, moves.deleteSubmission, caller, submissionId);

    const stmt = await db.prepare("SELECT * FROM submissions WHERE id = ?");
    const rows: Submission[] = await stmt.all(submissionId);
    await stmt.finalize();

    await deleteSubmissionRow(db, submissionId);

    return {
      memberId: submission.member_id,
      snapshot: rows[0],
      byCommittee: actor === "committee",
    };
  });

  // Only when the committee deleted someone else's work: a member deleting
  // their own Draft does not need to be told they did it.
  if (byCommittee) {
    const member = await getMember(memberId);
    if (member && snapshot) {
      await notifier().deletedByCommittee(snapshot, member);
    }
  }

  logger.info("Submission deleted", { submissionId, by: caller.id, byCommittee });
}

// ---------------------------------------------------------------------------
// Shared consequence helpers
// ---------------------------------------------------------------------------

/**
 * The feed entry for an approval. One entry per Submission, refreshed rather
 * than appended, so the feed holds an entry exactly as long as the thing it
 * announces exists.
 */
async function announceApproval(submission: Submission, member: MemberRecord): Promise<void> {
  try {
    await recordActivity("submission_approved", member.id, String(submission.id), {
      species_common_name: submission.species_common_name,
      species_type: submission.species_type,
      points: submission.points ?? 0,
      first_time_species: Boolean(submission.first_time_species),
      article_points: submission.article_points ?? undefined,
    });
  } catch (error) {
    logger.error("Failed to record approval in the activity feed", error);
  }
}

/** A Submission's Program, defaulting to the fish ladder for a stray value. */
function programOf(submission: Pick<Submission, "program">): Program {
  return isProgramType(submission.program) ? submission.program : "fish";
}

/** One field a correction changed. */
export type Change = {
  field: string;
  old: unknown;
  new: unknown;
};

/** Boolean columns arrive as 0/1 from SQLite and as booleans from Zod. */
const BOOLEAN_FIELDS = new Set([
  "first_time_species",
  "cares_species",
  "flowered",
  "sexual_reproduction",
]);

/**
 * What a set of updates would actually change, ignoring the several ways this
 * schema spells "empty".
 */
export function changesBetween(before: Submission, updates: Record<string, unknown>): Change[] {
  const changes: Change[] = [];

  for (const [field, proposed] of Object.entries(updates)) {
    if (proposed === undefined) {
      continue;
    }
    const current = (before as unknown as Record<string, unknown>)[field];

    if (BOOLEAN_FIELDS.has(field)) {
      const currentFlag = Boolean(current);
      const proposedFlag =
        typeof proposed === "boolean" ? proposed : Boolean(Number(proposed));
      if (currentFlag !== proposedFlag) {
        changes.push({ field, old: currentFlag, new: proposedFlag });
      }
      continue;
    }

    if (normalize(current) !== normalize(proposed)) {
      changes.push({ field, old: current, new: proposed });
    }
  }

  return changes;
}

function normalize(value: unknown): string | number | boolean | null {
  if (value === "" || value === null || value === undefined || value === "[]") {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

import type { Database } from "sqlite";
import { withTransaction } from "@/db/conn";
import {
  createSubmissionRow,
  deleteSubmissionRow,
  formToRow,
  getSubmissionById,
  setSubmissionSupplements,
  Submission,
} from "@/db/submissions";
import { getMember, MemberRecord } from "@/db/members";
import { addNote } from "@/db/submission_notes";
import { recordActivity } from "@/db/activity";
import type { FormValues } from "@/forms/submission";
import type { Program } from "@/levelManager";
import { isProgramType, type ProgramType } from "@/programs";
import {
  bonusesOutsideProgram,
  isArticleBonus,
  pointsBreakdown,
  programOfSpeciesType,
  type BonusFields,
  type PointsBreakdown,
  type PointsRow,
} from "@/points";
import {
  addName,
  canonicalName,
  CatalogueRefusal,
  checkFormAgreement,
  countSubmissionsOfSpecies,
  createSpeciesOn,
  ensurePointClass,
  findSpeciesById,
  isPointClass,
  type NameKind,
  type Species,
} from "@/species";
import { logger } from "@/utils/logger";
import { AuthorizationError, StalePointsError, ValidationError, StateError } from "./errors";
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
   witness_verification_status, changes_requested_on,
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

  assertMoveIsLegal(move, {
    state: deriveState(submission),
    changesPending: hasChangesRequested(submission),
    actor,
    actorId: caller.id,
    isOwner: submission.member_id === caller.id,
    bound: submission.species_id != null,
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
 * The binding a member's save leaves (CONTEXT.md, Bound).
 *
 * The member binds by picking a Name in the form's typeahead, which posts that
 * Species' id as `species_id`. The pick is a claim, not a binding: it is kept
 * only if the Species exists and the form agrees with it (`checkFormAgreement`:
 * each spelling blank or one of its Names, Species type and Program class
 * equal). A pick that does not hold saves the Submission unbound - a forged or
 * stale id is not an error, just no binding.
 *
 * With no pick, an existing binding holds only while the form still agrees
 * with it: saving a form that no longer agrees clears it. Clearing the
 * typeahead does not unbind by itself; what unbinds is a form that no longer
 * agrees.
 *
 * Only member saves ask this; committee moves never unbind.
 */
async function bindingAfterSave(
  submission: Pick<Submission, "species_id">,
  form: FormValues
): Promise<{ species_id?: number | null }> {
  const claimed = form.species_id ?? submission.species_id;
  if (claimed == null) return {};
  const agreement = await checkFormAgreement(claimed, form);
  return { species_id: agreement?.agrees ? claimed : null };
}

/**
 * Write a member's form over the Submission's content columns, leaving every
 * lifecycle column alone - except the binding, which the member's pick may
 * set and a form that no longer agrees clears (`bindingAfterSave`).
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
 * Its place in the approval queue goes with the Witness, since the queue is
 * derived from it: once re-witnessed, the clock puts it back.
 *
 * The points the Witness set go with it (ADR-0003): they were set against the
 * form the witness saw, and the next witness starts from the catalogue's
 * prefill again. First-time is never set before approval, so there is nothing
 * of it to clear.
 *
 * Only member saves call this. Committee moves, including a Points correction,
 * never touch the Witness.
 */
async function voidWitness(db: Database, submissionId: number, move: MoveDefinition): Promise<void> {
  await runUpdate(
    db,
    `UPDATE submissions SET
       witness_verification_status = 'pending',
       witnessed_by = NULL,
       witnessed_on = NULL,
       points = NULL,
       article_points = NULL,
       cares_species = NULL,
       flowered = NULL,
       sexual_reproduction = NULL
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
 * on another member's behalf. A Name picked in the form binds it, if the form
 * agrees with that Species (`bindingAfterSave`).
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
      ...(await bindingAfterSave({ species_id: null }, form)),
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
 * What the Witness sets about a Submission's points (ADR-0003): the Species,
 * the base points, and every bonus but first-time, which approval computes.
 * `species_id` left off means the Species the Submission is already bound to;
 * `article_points` null means no article bonus.
 */
export type WitnessPoints = {
  /** The Species the witness settled on; omitted means the bound Species. Not alongside `new_species`. */
  species_id?: number;
  /** A Species the catalogue lacks, recorded in the Witness's transaction and settled on (#522). */
  new_species?: NewSpeciesAtWitness;
  points: number;
  article_points: number | null;
  cares_species: boolean;
  flowered: boolean;
  sexual_reproduction: boolean;
};

/**
 * A Species the witness records because the catalogue has none for what the
 * member bred: its names, Point class and CARES flag from the panel's form.
 * Its Species type and Program class are the Submission's.
 */
export type NewSpeciesAtWitness = {
  canonicalGenus: string;
  canonicalSpeciesName: string;
  commonName: string | null;
  pointClass: number;
  isCaresSpecies: boolean;
};

/**
 * Confirm the Witness: a committee member has inspected the fry, settled the
 * Species, and set the points. The waiting period starts.
 *
 * One transaction, in order: rebind to the Species the witness chose, if it
 * is not the one bound; give the Submission its Species' type, class and
 * Program where they disagree; write the base points and bonuses; confirm
 * the Witness; value the Species if the catalogue had not (the chosen base
 * points become its Point class, with no opt-out); add the spellings the
 * witness chose (`namesToAdd`) as Names. A refused confirmation does none of
 * it. First-time is left NULL: approval counts it.
 *
 * Never the submitter, so the independence of the first gate is enforced
 * rather than trusted. Refused on a Submission bound to no Species that the
 * confirm names none for either, so nothing enters the waiting period
 * without one.
 *
 * The bonuses are judged against the Program the Submission will have once
 * confirmed, the chosen Species' Program, not the one the member filed under:
 * a plant Submission the witness settles on a Fish Species becomes a BAP row,
 * and a flowered bonus on it is refused here, whatever the panel's form said.
 */
export async function confirmWitness(
  caller: Caller,
  submissionId: number,
  witness: WitnessPoints,
  namesToAdd: NamesToAdd = {}
): Promise<void> {
  assertWitnessPointsWellFormed(witness);

  const { memberId, added, species, speciesChanges, valued } = await withTransaction(async (db) => {
    const submission = await readForGuard(db, submissionId);
    const species = await speciesNamedOrBound(submission, witness);

    assertMoveIsLegal(moves.confirmWitness, {
      state: deriveState(submission),
      changesPending: hasChangesRequested(submission),
      actor: actorFor(caller, submission),
      actorId: caller.id,
      isOwner: submission.member_id === caller.id,
      // A Species about to be recorded settles the Submission as a bound one does
      bound: species != null || witness.new_species != null,
    });
    // The guard refused an unbound Submission above, so there is a Species,
    // or one to record: created here so a refusal below rolls it back
    const chosen = witness.new_species ? await recordSpecies(db, submission, witness.new_species) : species!;
    assertBonusesFit(programOfSpeciesType(chosen.species_type), witness);

    const speciesChanges = await settleSpecies(db, submission, chosen, moves.confirmWitness);
    if (witness.new_species) {
      speciesChanges.unshift({ field: "new_species", old: null, new: canonicalName(chosen) });
    }

    await runUpdate(
      db,
      `UPDATE submissions SET
         points = ?,
         article_points = ?,
         cares_species = ?,
         flowered = ?,
         sexual_reproduction = ?,
         witnessed_by = ?,
         witnessed_on = ?,
         witness_verification_status = 'confirmed'
       WHERE id = ? AND witness_verification_status != 'confirmed' AND approved_on IS NULL`,
      [
        witness.points,
        witness.article_points,
        witness.cares_species ? 1 : 0,
        witness.flowered ? 1 : 0,
        witness.sexual_reproduction ? 1 : 0,
        caller.id,
        new Date().toISOString(),
        submissionId,
      ],
      moves.confirmWitness
    );

    const valued = chosen.base_points == null && (await ensurePointClass(db, chosen.group_id, witness.points));
    // A recorded Species already carries the names the witness gave it, and
    // the agreement check reads on another connection, which cannot see it yet
    const added = witness.new_species ? {} : await addSpellingsAsNames(db, submissionId, chosen.group_id, namesToAdd);
    return { memberId: submission.member_id, added, species: chosen, speciesChanges, valued };
  });

  if (speciesChanges.length > 0) {
    await recordAdminEdit(submissionId, caller, speciesChanges, "Settled at the Witness");
  }

  // The letter says whether the member may be first with this Species: a fact
  // of the catalogue at the Witness, which approval decides for real
  const [submission, member, witnessMember, submissionsOfSpecies] = await Promise.all([
    getSubmissionById(submissionId),
    getMember(memberId),
    getMember(caller.id),
    countSubmissionsOfSpecies(species.group_id),
  ]);
  if (submission && member && witnessMember) {
    await notifier().witnessConfirmed(submission, member, witnessMember, {
      firstTime: submissionsOfSpecies.approved === 0,
    });
  }

  logger.info("Witness confirmed", {
    submissionId,
    witnessedBy: caller.id,
    speciesId: species.group_id,
    points: witness.points,
    pointClassSet: valued,
    speciesChanges,
    namesAdded: added,
  });
}

/**
 * Record the Species the witness says the catalogue lacks, inside the
 * Witness's (or the correction's) transaction: its names, Point class and
 * CARES flag from the panel, its Species type and Program class from the
 * Submission. The catalogue's refusals (a Canonical name another Species
 * holds, an empty name) become the move's.
 */
async function recordSpecies(db: Database, submission: Submission, draft: NewSpeciesAtWitness): Promise<Species> {
  try {
    return await createSpeciesOn(db, {
      canonicalGenus: draft.canonicalGenus,
      canonicalSpeciesName: draft.canonicalSpeciesName,
      commonName: draft.commonName,
      programClass: submission.species_class,
      speciesType: submission.species_type,
      pointClass: draft.pointClass,
      isCaresSpecies: draft.isCaresSpecies,
    });
  } catch (err) {
    if (err instanceof CatalogueRefusal) {
      throw new ValidationError(err.message, "new_scientific_name", draft.canonicalGenus);
    }
    throw err;
  }
}

/**
 * Refuse a bonus that `program` cannot carry, and an article bonus outside
 * none, 5 or 10. The route's schema asks the same of the form; this is the
 * transition's own word, so a bonus that fits the Program the Submission had
 * but not the one it is about to have is never written.
 */
function assertBonusesFit(program: ProgramType, witness: WitnessPoints): void {
  if (!isArticleBonus(witness.article_points)) {
    throw new ValidationError("The article bonus is None, 5 or 10", "article_points", witness.article_points);
  }
  const bonuses: BonusFields = witness;
  const [issue] = bonusesOutsideProgram(program, bonuses);
  if (issue) {
    throw new ValidationError(issue.message, issue.field, bonuses[issue.field]);
  }
}

/**
 * Settle the Submission on `species` inside the move's transaction: rebind
 * it if it is bound elsewhere, and give it the Species' type, class and
 * Program where the Submission's disagree. The witness answered "is that
 * right?" with the Species, so the Submission takes the Species' word on
 * both; a correction (`correctPoints`) answers the same way, from the
 * Witness on. The guard has already decided the move is legal, so the write
 * is conditioned on the row alone.
 * @returns what changed, for the changelog
 */
async function settleSpecies(
  db: Database,
  submission: Submission,
  species: Species,
  move: MoveDefinition
): Promise<Change[]> {
  const changes: Change[] = [];

  if (submission.species_id !== species.group_id) {
    await runUpdate(db, `UPDATE submissions SET species_id = ? WHERE id = ?`, [species.group_id, submission.id], move);
    const previous = submission.species_id == null ? undefined : await findSpeciesById(submission.species_id);
    changes.push({ field: "species", old: previous ? canonicalName(previous) : null, new: canonicalName(species) });
  }

  const adopted = {
    species_type: species.species_type,
    species_class: species.program_class,
    program: programOfSpeciesType(species.species_type),
  };
  const diff = changesBetween(submission, adopted);
  if (diff.length > 0) {
    await runUpdate(
      db,
      `UPDATE submissions SET species_type = ?, species_class = ?, program = ? WHERE id = ?`,
      [adopted.species_type, adopted.species_class, adopted.program, submission.id],
      move
    );
    changes.push(...diff);
  }

  return changes;
}

/**
 * The Species a Witness or a correction settles on: the one the move names
 * (`species_id`), the one bound, or none, with a Species that does not exist
 * refused. Null means a Species is about to be recorded, or there is none.
 */
async function speciesNamedOrBound(
  submission: Pick<Submission, "species_id">,
  witness: Pick<WitnessPoints, "species_id" | "new_species">
): Promise<Species | undefined> {
  const speciesId = witness.new_species ? null : (witness.species_id ?? submission.species_id);
  if (speciesId == null) return undefined;
  const species = await findSpeciesById(speciesId);
  if (!species) {
    throw new ValidationError("Choose a Species that exists", "species_id", speciesId);
  }
  return species;
}

/** The refusals a Witness and a correction share before either reads a row. */
function assertWitnessPointsWellFormed(witness: WitnessPoints): void {
  if (!isPointClass(witness.points)) {
    throw new ValidationError("Choose the base points: 5, 10, 15 or 20", "points", witness.points);
  }
  if (witness.new_species && witness.species_id != null) {
    throw new ValidationError("Choose a Species or record a new one, not both", "species_id", witness.species_id);
  }
  if (witness.new_species && !isPointClass(witness.new_species.pointClass)) {
    throw new ValidationError("The Point class is 5, 10, 15 or 20", "new_point_class", witness.new_species.pointClass);
  }
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
 * spelling that is blank, already a Name of that kind, or a scientific Name
 * in the common field (as `checkFormAgreement` decides: whole, any case) is
 * never added.
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
 * Bind a Submission to a Species from the catalogue, or rebind it to another,
 * while a Witness is awaited.
 *
 * A committee move - the witness's - so it does not touch the member's form.
 * It goes on the Submission's changelog, the same record a Points correction
 * writes. Binding to the Species it is already bound to changes nothing and
 * records nothing. Once the Witness is confirmed the Species and the points
 * were set together, so a plain bind is refused: the Species then changes
 * only through `correctPoints`, with the points and a reason (#528).
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
 * A committee move like `bindSpecies`, and like it legal only while a
 * Witness is awaited: the confirm adopts the classification itself, and
 * after it a correction does. On the changelog. When the Submission already
 * agrees it changes nothing and records nothing.
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
 * What approving would award a Submission as the row and the catalogue stand:
 * the points the Witness set, plus first-time if no approved Submission of
 * its Species exists yet, itemised over the one Points rule. The approval
 * queue shows it, the approve button posts its total, and `approve` works
 * it out again inside its transaction and refuses if the two differ.
 */
export type ApprovalPreview = PointsBreakdown & {
  /** Whether this approval would be the Species' first, earning the +5. */
  firstTime: boolean;
};

/**
 * The preview for one row, given how many approved Submissions its Species
 * has (`countSubmissionsOfSpecies` for one, `countApprovedBySpecies` for a
 * page of them; both in src/species). The row's own `first_time_species` is
 * ignored: it is NULL before approval, and approval decides it here.
 */
export function previewApproval(row: PointsRow, approvedBefore: number): ApprovalPreview {
  const firstTime = approvedBefore === 0;
  return { ...pointsBreakdown({ ...row, first_time_species: firstTime }), firstTime };
}

/**
 * Approve a Submission: record that the member brought the fry, plants or
 * coral to a meeting, and award the points the Witness set (ADR-0003).
 *
 * It takes no form. The only thing approval decides is first-time: whether
 * the Species has an approved Submission yet, counted inside the transaction
 * so that of two members bringing the same Species the first click wins. It
 * is the only way Points are ever awarded, so there is one place to look
 * when a total is questioned, and the only transition that touches a
 * member's standing upward.
 *
 * `expectedTotal` is the total the approver was shown. The transition works
 * out the total it would award and refuses with `StalePointsError`, writing
 * nothing, when they differ: a correction landed, or another approval of the
 * same Species took the first-time bonus since the page was loaded. The
 * caller shows the current total and asks again. A Submission with no
 * points (one written around the lifecycle) is refused too: it needs a
 * Witness, not an approval.
 */
export async function approve(caller: Caller, submissionId: number, expectedTotal: number): Promise<void> {
  const memberId = await withTransaction(async (db) => {
    const { submission } = await guard(db, moves.approve, caller, submissionId);

    // The whole row, not the guard's columns: the total is read off it
    const stmt = await db.prepare("SELECT * FROM submissions WHERE id = ?");
    const rows: Submission[] = await stmt.all(submissionId);
    await stmt.finalize();
    const row = rows[0];

    if (row.points == null) {
      throw new ValidationError(
        "This submission has no points: it needs a Witness before it can be approved",
        "points",
        null
      );
    }

    // The guard refused an unbound Submission, so species_id is set
    const preview = previewApproval(row, await approvedOfSpecies(db, row.species_id!));
    if (preview.total !== expectedTotal) {
      throw new StalePointsError(
        `The points changed: now ${preview.total} pts, not ${expectedTotal}`,
        expectedTotal,
        preview.total
      );
    }

    await runUpdate(
      db,
      `UPDATE submissions SET
         first_time_species = ?,
         approved_by = ?,
         approved_on = ?
       WHERE id = ? AND approved_on IS NULL`,
      [preview.firstTime ? 1 : 0, caller.id, new Date().toISOString(), submissionId],
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

  logger.info("Submission approved", {
    submissionId,
    by: caller.id,
    points: submission.points,
    firstTime: Boolean(submission.first_time_species),
    total: expectedTotal,
  });
}

/**
 * How many approved Submissions a Species has, read on the transaction's
 * connection so the count and the write it decides are one unit.
 */
async function approvedOfSpecies(db: Database, speciesId: number): Promise<number> {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM submissions WHERE species_id = ? AND approved_on IS NOT NULL",
    speciesId
  );
  return row?.n ?? 0;
}

/**
 * What a correction sets (#528): everything the Witness set (`WitnessPoints`:
 * the Species, or a new one to record, the base points and the bonuses), and
 * on an Approved Submission first-time too, since approval has decided it by
 * then and a mistaken answer is put right here. Before approval first-time is
 * NULL and a value for it is refused.
 */
export type PointsCorrection = WitnessPoints & {
  first_time_species?: boolean;
};

/**
 * Correct a Submission's Species and points, with a stated reason, from the
 * Witness on: in the waiting period, in the approval queue and once Approved.
 * This is how the committee acts on a member's dispute of the witness email
 * and on a bonus earned after approval (an article written later; a plant
 * that flowers later), and the only movement out of Approved.
 *
 * One transaction, the Witness's own shape: optionally record a new Species;
 * settle the Submission on the chosen Species (rebinding, and adopting its
 * type, class and Program where they disagree); write the points fields, and
 * first-time on an Approved Submission; value the Species if the catalogue
 * had not. The Species and the points change together, in one write with
 * one changelog entry, so a Submission never carries points set against a
 * Species it is no longer bound to. The Witness is left alone (see
 * `voidWitness`): the committee is correcting its own record, not the
 * member's form.
 *
 * What follows depends on which side of approval the Submission is. Before
 * it, nothing is recomputed, since the points count for nothing yet, and the
 * witness email goes again with the new breakdown and "Points corrected:
 * <reason>". After it, the feed entry is updated in place rather than
 * announced again, the member's standing is recomputed (in the Program it
 * left too, if the Species moved it), and the approval email goes again.
 *
 * Returns the fields that changed, which is also what the changelog records.
 */
export async function correctPoints(
  caller: Caller,
  submissionId: number,
  correction: PointsCorrection,
  reason: string
): Promise<Change[]> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ValidationError("A correction needs a stated reason", "reason", reason);
  }
  assertWitnessPointsWellFormed(correction);

  const { before, after, changes, species, valued } = await withTransaction(async (db) => {
    // The whole row, not the guard's columns: the changelog diffs against it
    const stmt = await db.prepare("SELECT * FROM submissions WHERE id = ?");
    const rows: Submission[] = await stmt.all(submissionId);
    await stmt.finalize();
    const before = rows[0];
    if (!before) {
      throw new ValidationError("Submission not found", "submissionId", submissionId);
    }
    const named = await speciesNamedOrBound(before, correction);

    assertMoveIsLegal(moves.correctPoints, {
      state: deriveState(before),
      changesPending: hasChangesRequested(before),
      actor: actorFor(caller, before),
      actorId: caller.id,
      isOwner: before.member_id === caller.id,
      // The Species the correction names settles the Submission as a bound one does
      bound: named != null || correction.new_species != null,
    });

    const approved = before.approved_on != null;
    if (!approved && correction.first_time_species !== undefined) {
      throw new ValidationError(
        "First-time is decided at approval; it cannot be set before then",
        "first_time_species",
        correction.first_time_species
      );
    }

    // The guard refused an unbound Submission above, so there is a Species,
    // or one to record: created here so a refusal below rolls it back
    const chosen = correction.new_species ? await recordSpecies(db, before, correction.new_species) : named!;
    assertBonusesFit(programOfSpeciesType(chosen.species_type), correction);

    const speciesChanges = await settleSpecies(db, before, chosen, moves.correctPoints);
    if (correction.new_species) {
      speciesChanges.unshift({ field: "new_species", old: null, new: canonicalName(chosen) });
    }

    const points: Record<string, unknown> = {
      points: correction.points,
      article_points: correction.article_points,
      cares_species: correction.cares_species,
      flowered: correction.flowered,
      sexual_reproduction: correction.sexual_reproduction,
      first_time_species: approved ? correction.first_time_species : undefined,
    };
    // No article bonus is stored as NULL since ADR-0003 and as 0 before it;
    // the two mean the same, so a correction that keeps "none" changes nothing
    const pointChanges = changesBetween({ ...before, article_points: before.article_points || null }, points);
    const changes = [...speciesChanges, ...pointChanges];
    if (changes.length === 0) {
      throw new ValidationError("No changes detected", "updates", correction);
    }

    await runUpdate(
      db,
      `UPDATE submissions SET
         points = ?,
         article_points = ?,
         cares_species = ?,
         flowered = ?,
         sexual_reproduction = ?,
         first_time_species = COALESCE(?, first_time_species)
       WHERE id = ? AND (approved_on IS NOT NULL OR witness_verification_status = 'confirmed')`,
      [
        correction.points,
        correction.article_points,
        correction.cares_species ? 1 : 0,
        correction.flowered ? 1 : 0,
        correction.sexual_reproduction ? 1 : 0,
        approved && correction.first_time_species !== undefined ? (correction.first_time_species ? 1 : 0) : null,
        submissionId,
      ],
      moves.correctPoints
    );

    const valued = chosen.base_points == null && (await ensurePointClass(db, chosen.group_id, correction.points));
    const afterRows: Submission[] = await db.all("SELECT * FROM submissions WHERE id = ?", submissionId);
    return { before, after: afterRows[0], changes, species: chosen, valued };
  });

  await recordAdminEdit(submissionId, caller, changes, trimmed);

  const member = await getMember(before.member_id);
  if (member) {
    if (after.approved_on != null) {
      // Awarded points moved: the feed entry, the standing and the member's letter follow
      await announceApproval(after, member);
      await recomputeStanding(member.id, programOf(after));
      if (programOf(before) !== programOf(after)) {
        await recomputeStanding(member.id, programOf(before));
      }
      await notifier().approved(after, member);
    } else {
      // Pending points moved: the member hears the new breakdown, and why
      const [witnessMember, submissionsOfSpecies] = await Promise.all([
        after.witnessed_by == null ? Promise.resolve(undefined) : getMember(after.witnessed_by),
        countSubmissionsOfSpecies(species.group_id),
      ]);
      if (witnessMember) {
        await notifier().witnessConfirmed(after, member, witnessMember, {
          firstTime: submissionsOfSpecies.approved === 0,
          correctionReason: trimmed,
        });
      }
    }
  }

  logger.info("Points corrected", {
    submissionId,
    by: caller.id,
    approved: after.approved_on != null,
    speciesId: species.group_id,
    pointClassSet: valued,
    changes,
  });
  return changes;
}

/**
 * The columns a details edit may touch: what the member filled in about the
 * breeding, the tank and the record of it. Not the Species columns, not the
 * points columns, not the lifecycle's own: those are `correctPoints`'s or
 * nobody's.
 */
const DETAIL_FIELDS = [
  "reproduction_date",
  "count",
  "foods",
  "spawn_locations",
  "propagation_method",
  "tank_size",
  "filter_type",
  "water_change_volume",
  "water_change_frequency",
  "temperature",
  "ph",
  "gh",
  "specific_gravity",
  "substrate_type",
  "substrate_depth",
  "substrate_color",
  "light_type",
  "light_strength",
  "light_hours",
  "co2",
  "co2_description",
  "video_url",
  "article_link",
  "notes",
] as const satisfies readonly (keyof Submission)[];

/** The member's details on an Approved Submission, as a details edit writes them. */
export type ApprovedDetails = Partial<Pick<Submission, (typeof DETAIL_FIELDS)[number]>>;

/**
 * Edit the member's details on an Approved Submission, with a stated reason
 * (#529): the tank, the foods, the dates and the like, which the member can
 * no longer edit themselves since Approved is terminal. The Edit Approved
 * Submission dialog's write.
 *
 * Never the Species or the points: a field of theirs in `details` refuses
 * the whole edit, since those changes carry consequences (the member's
 * letter, the feed entry, the standing) that go through `correctPoints`.
 * A details edit has none of them: it goes on the changelog, as every
 * committee change to a member's record does, and tells nobody and
 * recomputes nothing, because nothing it changes counts toward a standing.
 * The Witness is left alone (see `voidWitness`): the committee is amending
 * the record, not the member re-filing.
 *
 * Returns the fields that changed, which is also what the changelog records.
 */
export async function editApprovedDetails(
  caller: Caller,
  submissionId: number,
  details: ApprovedDetails,
  reason: string
): Promise<Change[]> {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ValidationError("An edit needs a stated reason", "reason", reason);
  }
  const allowed: ReadonlySet<string> = new Set(DETAIL_FIELDS);
  for (const [field, value] of Object.entries(details)) {
    if (!allowed.has(field)) {
      throw new ValidationError(
        `${field} is not a detail: the Species and points are changed on the correction form`,
        field,
        value
      );
    }
  }

  const changes = await withTransaction(async (db) => {
    await guard(db, moves.editApprovedDetails, caller, submissionId);

    // The full row, not just the guard's columns: the changelog diffs against
    // what is actually stored.
    const stmt = await db.prepare("SELECT * FROM submissions WHERE id = ?");
    const rows: Submission[] = await stmt.all(submissionId);
    await stmt.finalize();
    const before = rows[0];

    const diff = changesBetween(before, details);
    if (diff.length === 0) {
      throw new ValidationError("No changes detected", "details", details);
    }

    const entries = Object.entries(details).filter(([, value]) => value !== undefined);
    const setClause = entries.map(([field]) => `${field} = ?`).join(", ");
    await runUpdate(
      db,
      `UPDATE submissions SET ${setClause} WHERE id = ? AND approved_on IS NOT NULL`,
      [...entries.map(([, value]) => value), submissionId],
      moves.editApprovedDetails
    );

    return diff;
  });

  await recordAdminEdit(submissionId, caller, changes, trimmed);

  logger.info("Approved submission details edited", { submissionId, by: caller.id, changes });
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

import { Response } from "express";
import { z } from "zod";
import {
  getBapFormTitle,
  getClassOptions,
  waterTypes,
  speciesTypes,
  foodTypes,
  spawnLocations,
  bapDraftForm,
  bapFields,
  bapForm,
  FormValues,
  hasFoods,
  hasSpawnLocations,
  hasLighting,
  hasSupplements,
  isLivestock,
} from "@/forms/submission";
import { extractValid } from "@/forms/utils";
import { getQueryString, getBodyString } from "@/utils/request";
import { MulmRequest } from "@/sessions";
import { MemberRecord, getMember, getMembersList } from "@/db/members";
import * as db from "@/db/submissions";
import {
  getSubmissionImages,
  getSubmissionSupplements,
} from "@/db/submissions";
import {
  canonicalName as canonicalNameOf,
  checkFormAgreement,
  countSubmissionsOfSpecies,
  findSpeciesById,
  isSpeciesType,
  listNames,
  suggestSpecies,
} from "@/species";
import * as lifecycle from "@/lifecycle";
import { attempt, callerFor } from "./lifecycleErrors";
import { getNotesForSubmission, type SubmissionNote } from "@/db/submission_notes";
import { formatShortDate } from "@/utils/dateFormat";
import { pointsBreakdown, programOfSpeciesType, type PointsBreakdown, type PointsRow } from "@/points";
import { parseVideoUrlWithOEmbed, isValidVideoUrl } from "@/utils/videoParser";
import config from "@/config.json";

async function getFormTemplateData(isAdmin: boolean, speciesType: string) {
  const members = isAdmin ? await getMembersList() : [];

  return {
    classOptions: getClassOptions(speciesType),
    waterTypes,
    speciesTypes,
    foodTypes,
    spawnLocations,
    isLivestock: isLivestock(speciesType),
    hasFoods: hasFoods(speciesType),
    hasSpawnLocations: hasSpawnLocations(speciesType),
    hasLighting: hasLighting(speciesType),
    hasSupplements: hasSupplements(speciesType),
    isAdmin,
    members,
  };
}

export const renderSubmissionForm = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const form = {
    // auto-fill member ID if logged in
    member_id: viewer?.id,
    member_name: viewer?.display_name,
    ...req.query,
  };

  const selectedType = getQueryString(req, "species_type", "Fish");
  const templateData = await getFormTemplateData(Boolean(viewer?.is_admin), selectedType);

  res.render("submit", {
    title: getBapFormTitle(selectedType),
    form,
    errors: new Map(),
    ...templateData,
  });
};

export const view = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  const { viewer } = req;

  // Unapproved work is its member's and the committee's; to anyone else it
  // doesn't exist.
  if (!lifecycle.isVisibleTo(submission, viewer)) {
    res.status(404).send("Submission not found");
    return;
  }

  const parseStringArray = (jsonString: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // JSON parse failed, return empty array
    }
    return [];
  };

  let approver: MemberRecord | undefined;
  if (submission.approved_by != null) {
    approver = await getMember(submission.approved_by);
  }

  let witness: MemberRecord | undefined;
  if (submission.witnessed_by != null) {
    witness = await getMember(submission.witnessed_by);
  }

  const state = lifecycle.deriveState(submission);

  // The Species the Submission is bound to, if any
  const boundSpecies = submission.species_id ? await findSpeciesById(submission.species_id) : undefined;

  const aspect = {
    isSubmitted: submission.submitted_on != null,
    isApproved: submission.approved_on != null,
    isLoggedIn: Boolean(viewer),
    isSelf: viewer && submission.member_id === viewer.id,
    isAdmin: viewer && viewer.is_admin,
    state,
    changesRequested: lifecycle.hasChangesRequested(submission),
    // Which moves this viewer may actually make, asked of the same table the
    // transitions guard against - so nobody is shown a button that will refuse
    // them.
    allowed: allowedMoves(viewer, submission, state),
  };

  // A Draft has nothing to review, so its owner goes straight to the form.
  // Everything else shows the review page, with an Edit link when editing is
  // legal - so the member can see where their Submission stands.
  if (viewer && aspect.isSelf && state === "draft") {
    await renderEditForm(res, submission, viewer);
    return;
  }

  const speciesShown = (() => {
    if (boundSpecies) return boundSpecies;

    // Fall back to parsing the member's Latin spelling
    const [genus, ...parts] = submission.species_latin_name.split(" ");
    return {
      canonical_genus: genus,
      canonical_species_name: parts.join(" "),
    };
  })();

  const canonicalName = canonicalNameOf(speciesShown);

  // Calculate waiting period eligibility
  const waitingPeriodStatus = lifecycle.waitingPeriod(submission);

  // Fetch admin notes if viewer is an admin
  const adminNotes = aspect.isAdmin ? await getNotesForSubmission(submission.id) : [];

  // The witness panel's locals while a Witness is awaited; in the approval
  // queue the committee's panel reads the bound Species for what approval
  // would award (`previewApproval`), the same preview the queue page shows
  const witnessPanel =
    viewer && aspect.isAdmin && state === "pendingWitness"
      ? await witnessPanelLocals(submission, viewer, { notes: adminNotes })
      : null;
  const speciesFacts = witnessPanel
    ? witnessPanel.speciesFacts
    : aspect.isAdmin && state === "inApprovalQueue"
      ? await boundSpeciesFacts(submission)
      : null;
  const approvalPreview =
    !witnessPanel && speciesFacts && submission.points != null
      ? lifecycle.previewApproval(submission, speciesFacts.priorBreedCount)
      : null;

  // What the witness set, shown to the owner alone until it is awarded
  const pending = pendingPoints(submission, viewer);

  // Fetch oEmbed data for video if present
  let videoMetadata = null;
  if (submission.video_url) {
    videoMetadata = await parseVideoUrlWithOEmbed(submission.video_url);
  }

  // Fetch images from normalized table
  const images = await getSubmissionImages(submission.id);

  // Prepare Open Graph data for social media sharing (approved submissions only)
  let ogData = null;
  if (aspect.isApproved) {
    const firstImageUrl = images.length > 0 ? images[0].public_url : null;

    ogData = {
      title: `${submission.member_name} bred ${canonicalName}`,
      description: `BAP submission - ${submission.points || 0} points - ${submission.species_common_name}`,
      url: `https://${config.server.domain}/submissions/${submission.id}`,
      image: firstImageUrl,
    };
  }

  res.render("submission/review", {
    submission: {
      ...submission,
      reproduction_date: formatShortDate(submission.reproduction_date),
      submitted_on: formatShortDate(submission.submitted_on),
      witnessed_on: formatShortDate(submission.witnessed_on),
      approved_on: formatShortDate(submission.approved_on),
      approved_by: approver?.display_name,
      witnessed:
        witness && submission.witnessed_on
          ? `${witness.display_name} - ${formatShortDate(submission.witnessed_on)}`
          : undefined,
      approved:
        approver && submission.approved_on
          ? `${approver.display_name} - ${formatShortDate(submission.approved_on)}`
          : undefined,

      foods: parseStringArray(submission.foods).join(","),
      spawn_locations: parseStringArray(submission.spawn_locations).join(","),
      images, // Pass array of image objects instead of JSON string
    },
    canonicalName,
    name: speciesShown,
    boundSpecies: boundSpecies ?? null,
    boundSpeciesName: boundSpecies ? canonicalNameOf(boundSpecies) : null,
    speciesFacts,
    approvalPreview,
    // The committee's panel says so when the witness recorded the Species
    speciesRecordedByWitness: speciesRecordedByWitness(adminNotes),
    ...witnessPanel,
    pendingPoints: pending,
    waitingPeriodStatus,
    adminNotes,
    videoMetadata,
    ogData,
    ...aspect,
  });
};

/**
 * Render the Submission form over an existing Submission.
 *
 * The same form serves a Draft, an in-place edit and an answer to a request
 * for changes; which buttons it offers follows from the Submission's own
 * columns, and which move a save performs is decided in `update`.
 */
async function renderEditForm(
  res: Response,
  submission: db.Submission,
  viewer: NonNullable<MulmRequest["viewer"]>
): Promise<void> {
  const templateData = await getFormTemplateData(
    Boolean(viewer.is_admin),
    submission.species_type
  );

  let changesRequested = null;
  if (submission.changes_requested_on) {
    const adminWhoRequested = submission.changes_requested_by
      ? await getMember(submission.changes_requested_by)
      : null;

    changesRequested = {
      reason: submission.changes_requested_reason,
      requestedBy: adminWhoRequested?.display_name || "Admin",
      requestedOn: formatShortDate(submission.changes_requested_on),
    };
  }

  const supplements = await getSubmissionSupplements(submission.id);
  const images = await getSubmissionImages(submission.id);

  res.render("submit", {
    title: `Edit ${getBapFormTitle(submission.program)}`,
    form: {
      ...submission,
      member_id: submission.member_id,
      member_name: viewer.display_name,
      foods: parseJsonStringArray(submission.foods),
      spawn_locations: parseJsonStringArray(submission.spawn_locations),
      supplement_type: supplements.map((s) => s.supplement_type),
      supplement_regimen: supplements.map((s) => s.supplement_regimen),
      images: JSON.stringify(
        images.map((img) => ({
          key: img.r2_key,
          url: img.public_url,
          size: img.file_size,
          uploadedAt: img.uploaded_at,
          contentType: img.content_type,
        }))
      ),
    },
    errors: new Map(),
    changesRequested,
    witnessConfirmed: lifecycle.hasConfirmedWitness(submission),
    ...templateData,
  });
}

/** A JSON-encoded string array column, or an empty array if it is not one. */
function parseJsonStringArray(jsonString: string): string[] {
  try {
    const parsed: unknown = JSON.parse(jsonString);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Not a JSON array; treat it as empty.
  }
  return [];
}

/**
 * GET /submissions/:id/edit
 *
 * The edit form, reached from the review page. Opening it changes nothing -
 * which is the point: a member clicking Edit no longer has their Submission
 * pulled out of the queue it is waiting in before they have typed anything.
 */
export const renderEdit = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const allowed = allowedMoves(viewer, submission, lifecycle.deriveState(submission));
  if (!allowed.saveDraft && !allowed.saveChanges && !allowed.resubmit) {
    res.status(403).send("This submission can no longer be edited");
    return;
  }

  await renderEditForm(res, submission, viewer);
};

/**
 * What the witness panel and the committee's queue panel show about the Species a
 * Submission is bound to: its Canonical name, a common Name, its
 * classification and the Program it belongs to (which decides the bonuses the
 * witness panel offers, since confirming adopts it), its Point class (which
 * prefills the base points), and the bonuses it implies - first time in the
 * Program for this Species, and CARES. Null when the Submission is unbound,
 * which each panel says in its own way.
 */
export async function boundSpeciesFacts(submission: Pick<db.Submission, "species_id">) {
  const species = submission.species_id ? await findSpeciesById(submission.species_id) : undefined;
  if (!species) return null;
  // First-time is program-wide: no member has had this Species approved yet
  const [submissionsOfSpecies, names] = await Promise.all([
    countSubmissionsOfSpecies(species.group_id),
    listNames(species.group_id),
  ]);
  return {
    speciesId: species.group_id,
    speciesName: canonicalNameOf(species),
    commonName: names.common[0]?.name ?? null,
    speciesType: species.species_type,
    programClass: species.program_class,
    program: programOfSpeciesType(species.species_type),
    pointClass: species.base_points,
    isFirstTime: submissionsOfSpecies.approved === 0,
    priorBreedCount: submissionsOfSpecies.approved,
    isCaresSpecies: species.is_cares_species === 1,
  };
}

/**
 * The Program a Submission belongs to by its Species type, which is what a
 * Species recorded at the Witness takes (#522); the filed Program stands in
 * for a type the Programs do not know.
 */
export function programOfSubmission(submission: Pick<db.Submission, "species_type" | "program">): string {
  return isSpeciesType(submission.species_type) ? programOfSpeciesType(submission.species_type) : submission.program;
}

/** A catalogue neighbour of what the member wrote, as the witness panel lists it under "Did they mean one of these?". */
export type SpeciesSuggestionFacts = {
  speciesId: number;
  commonName: string | null;
  speciesName: string;
  speciesType: string;
  programClass: string;
  pointClass: number | null;
};

/**
 * A Species the witness is recording, as the panel shows it between Record
 * species and continue and the confirm: not yet in the catalogue, so these
 * are the form's values plus the Submission's type and class, which the
 * Species will take (`recordSpecies`, src/lifecycle/transitions.ts).
 */
export type NewSpeciesFacts = {
  scientificName: string;
  commonName: string | null;
  speciesType: string;
  programClass: string;
  program: string;
  pointClass: number;
  isCaresSpecies: boolean;
};

/**
 * Everything the witness panel renders from, for the Submission page and for
 * the Record new species step, which re-renders the panel with the new
 * Species settled (#522). `newSpecies` is that Species as the step validated
 * it, carried in the panel's hidden fields until the confirm creates it;
 * `notes` are the Submission's changelog, passed in when the caller already
 * has them. The notes also say who witnessed a Submission before the reset
 * migration sent it back (#524), which the header shows as `originalWitness`.
 */
export async function witnessPanelLocals(
  submission: db.Submission,
  viewer: NonNullable<MulmRequest["viewer"]>,
  options: { notes?: SubmissionNote[]; newSpecies?: lifecycle.NewSpeciesAtWitness | null } = {}
) {
  const state = lifecycle.deriveState(submission);
  const notes = options.notes ?? (await getNotesForSubmission(submission.id));
  const [speciesFacts, agreement, suggested] = await Promise.all([
    boundSpeciesFacts(submission),
    submission.species_id ? checkFormAgreement(submission.species_id, submission) : undefined,
    suggestSpecies(
      { commonName: submission.species_common_name, latinName: submission.species_latin_name },
      { exclude: submission.species_id }
    ),
  ]);
  const speciesChosenByWitness = speciesChosenByCommittee(notes);
  // Who saw the fry before migration 066 reset the Witness (#524), so the
  // re-witnesser knows no fresh sighting is needed
  const original = lifecycle.originalWitnessFromNotes(notes);
  const draft = options.newSpecies ?? null;
  const newSpecies: NewSpeciesFacts | null = draft
    ? {
        scientificName: `${draft.canonicalGenus} ${draft.canonicalSpeciesName}`,
        commonName: draft.commonName,
        speciesType: submission.species_type,
        programClass: submission.species_class,
        program: programOfSubmission(submission),
        pointClass: draft.pointClass,
        isCaresSpecies: draft.isCaresSpecies,
      }
    : null;
  const settledProgram = newSpecies ? newSpecies.program : speciesFacts?.program;

  return {
    speciesFacts,
    // Whether the committee, not the member, chose the bound Species: the
    // panel then shows it as the witness's choice, not the member's
    speciesChosenByWitness,
    originalWitness: original ? { name: original.name, date: formatShortDate(original.date) } : null,
    classificationMismatch: agreement ? !agreement.classificationAgrees : false,
    // Which spellings are already Names of the Species, for the Names to add
    spellingAgreement: agreement ? { commonName: agreement.commonName, latinName: agreement.latinName } : null,
    suggestions: suggested.map(
      (species): SpeciesSuggestionFacts => ({
        speciesId: species.group_id,
        commonName: species.common_name,
        speciesName: canonicalNameOf(species),
        speciesType: species.species_type,
        programClass: species.program_class,
        pointClass: species.base_points,
      })
    ),
    newSpecies,
    // The sticky bar, as the panel's prefill sums
    summary: witnessSummary({
      bound: newSpecies != null || speciesFacts != null,
      species_settled: newSpecies != null || speciesChosenByWitness,
      points: newSpecies ? newSpecies.pointClass : (speciesFacts?.pointClass ?? null),
      article_points: submission.article_link ? 5 : null,
      cares_species:
        settledProgram === "fish" ? Boolean(newSpecies ? newSpecies.isCaresSpecies : speciesFacts?.isCaresSpecies) : false,
      flowered: false,
      sexual_reproduction: false,
    }),
    allowed: allowedMoves(viewer, submission, state),
    changesRequested: lifecycle.hasChangesRequested(submission),
  };
}

/**
 * What the correction form (#528) renders beyond the witness panel's locals:
 * which side of approval the Submission is on, whether the Species settled on
 * the form is a change from the bound one (chosen on the form, written only
 * by Save), and the row's current points, which prefill the Points card
 * unless the Species changed, when the new Species' Point class does.
 */
export type CorrectionFacts = {
  approved: boolean;
  speciesChanged: boolean;
  current: {
    points: number | null;
    article_points: number | null;
    cares_species: boolean;
    flowered: boolean;
    sexual_reproduction: boolean;
    first_time_species: boolean;
  };
};

/**
 * Everything the correction form renders from (#528): the witness panel's
 * Species and Points cards over the row's current values, with a reason and
 * Save correction in place of Confirm witness. `speciesId` is a Species
 * chosen on the form and carried in it, not yet written, so the panel shows
 * it settled and prefills the base points from its Point class; `newSpecies`
 * is one the Record new species step validated, as for the witness panel.
 * Nothing here is legal to post for a Submission the table refuses, which
 * the route checks before rendering.
 */
export async function correctionPanelLocals(
  submission: db.Submission,
  viewer: NonNullable<MulmRequest["viewer"]>,
  options: { speciesId?: number; newSpecies?: lifecycle.NewSpeciesAtWitness | null } = {}
) {
  const state = lifecycle.deriveState(submission);
  const chosenId = options.newSpecies ? null : (options.speciesId ?? submission.species_id);
  const speciesChanged = options.newSpecies != null || (chosenId != null && chosenId !== submission.species_id);
  const [speciesFacts, agreement, suggested] = await Promise.all([
    boundSpeciesFacts({ species_id: chosenId }),
    chosenId ? checkFormAgreement(chosenId, submission) : undefined,
    suggestSpecies(
      { commonName: submission.species_common_name, latinName: submission.species_latin_name },
      { exclude: chosenId }
    ),
  ]);
  const draft = options.newSpecies ?? null;
  const newSpecies: NewSpeciesFacts | null = draft
    ? {
        scientificName: `${draft.canonicalGenus} ${draft.canonicalSpeciesName}`,
        commonName: draft.commonName,
        speciesType: submission.species_type,
        programClass: submission.species_class,
        program: programOfSubmission(submission),
        pointClass: draft.pointClass,
        isCaresSpecies: draft.isCaresSpecies,
      }
    : null;
  const approved = submission.approved_on != null;
  const current = {
    points: submission.points,
    article_points: submission.article_points || null,
    cares_species: Boolean(submission.cares_species),
    flowered: Boolean(submission.flowered),
    sexual_reproduction: Boolean(submission.sexual_reproduction),
    first_time_species: Boolean(submission.first_time_species),
  };
  const settledProgram = newSpecies ? newSpecies.program : speciesFacts?.program;
  // The Points card's prefill: the row as it stands, or the new Species' Point
  // class and CARES flag when the Species changed; the member's bonuses stay
  const prefill = {
    points: speciesChanged ? (newSpecies ? newSpecies.pointClass : (speciesFacts?.pointClass ?? null)) : current.points,
    cares_species: speciesChanged
      ? settledProgram === "fish" && Boolean(newSpecies ? newSpecies.isCaresSpecies : speciesFacts?.isCaresSpecies)
      : current.cares_species,
  };

  return {
    speciesFacts,
    speciesChosenByWitness: true,
    originalWitness: null,
    classificationMismatch: agreement ? !agreement.classificationAgrees : false,
    spellingAgreement: null,
    suggestions: suggested.map(
      (species): SpeciesSuggestionFacts => ({
        speciesId: species.group_id,
        commonName: species.common_name,
        speciesName: canonicalNameOf(species),
        speciesType: species.species_type,
        programClass: species.program_class,
        pointClass: species.base_points,
      })
    ),
    newSpecies,
    correction: { approved, speciesChanged, current } satisfies CorrectionFacts,
    summary: witnessSummary({
      bound: newSpecies != null || speciesFacts != null,
      species_settled: true,
      points: prefill.points,
      article_points: current.article_points,
      cares_species: prefill.cares_species,
      flowered: current.flowered,
      sexual_reproduction: current.sexual_reproduction,
      first_time_species: approved ? current.first_time_species : false,
    }),
    summaryButton: CORRECTION_BUTTON,
    allowed: allowedMoves(viewer, submission, state),
    changesRequested: lifecycle.hasChangesRequested(submission),
  };
}

/** The sticky bar's button on the correction form, in place of Confirm witness. */
export const CORRECTION_BUTTON = { id: "correction-save", label: "Save correction" };

/** The witness panel's sticky bar: ready to confirm, or why not yet. */
export type WitnessSummary = PointsBreakdown & {
  ready: boolean;
  /** What is still missing, when not ready. */
  hint: string | null;
};

/**
 * The points a Submission's owner is shown before they are awarded (#523):
 * itemised as the witness set them, labelled "pending approval" by the views.
 * Null for everyone and everything else: the public never sees an unapproved
 * Submission, the committee reads the points on its own panels, and an
 * approved Submission shows what was awarded instead. A row with points but
 * no approval is always witnessed (the invariant ADR-0003 states), so "the
 * witness set them" needs no second check.
 */
export function pendingPoints(
  submission: Pick<db.Submission, "member_id" | "approved_on"> & PointsRow,
  viewer: MulmRequest["viewer"]
): PointsBreakdown | null {
  if (!viewer || viewer.id !== submission.member_id) return null;
  if (submission.approved_on != null || submission.points == null) return null;
  return pointsBreakdown(submission);
}

/**
 * Sum what the witness panel has set so far, over the one Points rule
 * (`pointsBreakdown`, src/points.ts), so the bar's lines add up to its
 * total. Not ready until the Species is settled and the base points
 * chosen, in that order, which is also the order the panel asks them in.
 */
export function witnessSummary(values: {
  bound: boolean;
  species_settled: boolean;
  points: number | null;
  article_points: number | null;
  cares_species: boolean;
  flowered: boolean;
  sexual_reproduction: boolean;
  /** The correction form's switch on an Approved Submission (#528); the Witness never sets it. */
  first_time_species?: boolean;
}): WitnessSummary {
  const notYet = (hint: string): WitnessSummary => ({ ready: false, lines: [], total: 0, hint });
  if (!values.bound) return notYet("Choose the species first");
  if (!values.species_settled) return notYet("Is the species right? Answer above first");
  if (values.points == null) return notYet("Choose the base points");

  return {
    ready: true,
    ...pointsBreakdown({
      points: values.points,
      article_points: values.article_points,
      cares_species: values.cares_species,
      flowered: values.flowered,
      sexual_reproduction: values.sexual_reproduction,
      first_time_species: values.first_time_species ?? false,
    }),
    hint: null,
  };
}

/** The shape of a changelog note, as `recordAdminEdit` writes it. */
const adminEditNote = z.object({
  type: z.literal("admin_edit"),
  changes: z.array(z.object({ field: z.string() })),
});

/** Whether any changelog entry changed `field`. A note that is not JSON, or not an edit, changed nothing. */
function changelogChanged(notes: Pick<SubmissionNote, "note_text">[], field: string): boolean {
  return notes.some((note) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(note.note_text);
    } catch {
      return false;
    }
    const entry = adminEditNote.safeParse(parsed);
    return entry.success && entry.data.changes.some((change) => change.field === field);
  });
}

/**
 * Whether the committee bound or rebound the Submission: a changelog entry
 * that changed its `species`. The member's own pick leaves no such entry.
 */
export function speciesChosenByCommittee(notes: Pick<SubmissionNote, "note_text">[]): boolean {
  return changelogChanged(notes, "species");
}

/**
 * Whether the witness recorded the Species because the catalogue lacked it
 * (#522): the "Settled at the Witness" entry then carries a `new_species`
 * change. The approval queue reads it as "New species recorded by the
 * witness"; `findSubmissionsWithRecordedSpecies` (src/db/submission_notes.ts)
 * answers the same for a whole page of rows.
 */
export function speciesRecordedByWitness(notes: Pick<SubmissionNote, "note_text">[]): boolean {
  return changelogChanged(notes, "new_species");
}

/**
 * The moves this viewer may make on this Submission right now, keyed by move
 * id for the template. Asked of the transition table rather than restated, so
 * the buttons shown and the guards enforced cannot drift apart.
 */
export function allowedMoves(
  viewer: MulmRequest["viewer"],
  submission: db.Submission,
  state: lifecycle.SubmissionState
): Partial<Record<lifecycle.MoveId, boolean>> {
  if (!viewer) {
    return {};
  }

  const isOwner = submission.member_id === viewer.id;
  const actor: lifecycle.Actor = isOwner ? "member" : viewer.is_admin ? "committee" : "member";
  const context: lifecycle.MoveContext = {
    state,
    changesPending: lifecycle.hasChangesRequested(submission),
    actor,
    actorId: viewer.id,
    isOwner,
    bound: submission.species_id != null,
  };

  return Object.fromEntries(
    Object.values(lifecycle.moves).map((move) => [move.id, lifecycle.canMove(move, context)])
  );
}

export async function validateSubmission(req: MulmRequest, res: Response) {
  // Support both :id and :subId for backward compatibility
  const subId = parseInt(req.params.id || req.params.subId);
  if (!subId) {
    res.status(400).send("Invalid submission id");
    return;
  }

  const submission = await db.getSubmissionById(subId);
  if (!submission) {
    res.status(404).send("Submission not found");
    return;
  }

  return submission;
}

function parseAndValidateForm(req: MulmRequest): {
  form: FormValues;
  draft: boolean;
  errors?: Map<string, string>;
} {
  let draft = false;
  let form: FormValues;
  let parsed;

  if ("draft" in req.body) {
    parsed = bapDraftForm.safeParse(req.body);
    form = extractValid(bapFields, req.body);
    draft = true;
    // For drafts, skip validation errors and accept partial data
    if (parsed.success) {
      form = { ...form, ...parsed.data };
    }
    return { form, draft };
  } else {
    parsed = bapForm.safeParse(req.body);
    form = extractValid(bapFields, req.body);
  }

  if (!parsed.success) {
    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    return { form, draft, errors };
  }

  form = { ...form, ...parsed.data };
  return { form, draft };
}

export const create = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const { form, draft, errors } = parseAndValidateForm(req);

  if (errors) {
    const selectedType = form.species_type || "Fish";
    const templateData = await getFormTemplateData(Boolean(viewer.is_admin), selectedType);
    res.render("bapForm/form", {
      title: getBapFormTitle(selectedType),
      form,
      errors,
      ...templateData,
    });
    return;
  }

  // Determine which member this submission is for. A committee member may
  // file on another member's behalf; the module enforces that.
  const memberId = form.member_id ? parseInt(String(form.member_id)) : viewer.id;

  const created = await attempt(res, { memberId, by: viewer.id }, () =>
    lifecycle.createSubmission(callerFor(viewer), memberId, form, { submit: !draft })
  );
  if (!created.ran) {
    return;
  }
  const subId = created.value;

  // Redirect after successful creation
  // When saving drafts for yourself (member or admin), go to /me
  // When admin saves draft for another member, go to submission view
  const isSavingForSelf = viewer.id === memberId;
  const redirectUrl = draft && isSavingForSelf ? "/me" : `/submissions/${subId}`;
  res.set("HX-Redirect", redirectUrl).status(200).send();
};

/**
 * PATCH /submissions/:id
 *
 * One form, four moves. Which one it is follows from where the Submission
 * already is, rather than from a hidden field: saving a Draft, submitting it,
 * answering a request for changes, or editing in place. Editing no longer
 * pulls a Submission out of the queue it is waiting in.
 */
export const update = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  if (!viewer) {
    res.status(401).send();
    return;
  }

  const { form, draft, errors } = parseAndValidateForm(req);
  if (errors) {
    const selectedType = form.species_type || "Fish";
    const templateData = await getFormTemplateData(Boolean(viewer.is_admin), selectedType);
    res.render("bapForm/form", {
      title: `Edit ${getBapFormTitle(selectedType)}`,
      form,
      errors,
      witnessConfirmed: lifecycle.hasConfirmedWitness(submission),
      ...templateData,
    });
    return;
  }

  const caller = callerFor(viewer);
  const state = lifecycle.deriveState(submission);

  const move = () => {
    if (state === "draft") {
      // On a Draft, "Save Draft" keeps it a Draft and "Submit" sends it.
      return draft
        ? lifecycle.saveDraft(caller, submission.id, form)
        : lifecycle.submit(caller, submission.id, form);
    }
    if (draft) {
      // "Save Draft" on work the committee has sent back means "save my
      // progress without answering them yet" - an edit in place, not a
      // withdrawal. Returning to Draft is its own named action.
      return lifecycle.saveChanges(caller, submission.id, form);
    }
    if (lifecycle.hasChangesRequested(submission)) {
      return lifecycle.resubmit(caller, submission.id, form);
    }
    return lifecycle.saveChanges(caller, submission.id, form);
  };

  if (!(await attempt(res, { submissionId: submission.id, by: viewer.id }, move)).ran) {
    return;
  }

  // Redirect after successful update
  // When saving drafts for yourself (member or admin), go to /me
  // When admin saves draft for another member, go to submission view
  const isSavingForSelf = viewer.id === submission.member_id;
  const redirectUrl = draft && isSavingForSelf ? "/me" : `/submissions/${submission.id}`;
  res.set("HX-Redirect", redirectUrl).status(200).send();
};

/**
 * POST /submissions/:id/return-to-draft
 *
 * Withdrawing, as its own named action. Submitting again saves the form, which
 * voids a confirmed Witness (ADR-0001), so the Submission is witnessed again.
 */
export const returnToDraft = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const done = await attempt(res, { submissionId: submission.id, by: viewer.id }, () =>
    lifecycle.returnToDraft(callerFor(viewer), submission.id)
  );
  if (!done.ran) {
    return;
  }

  res.set("HX-Redirect", `/submissions/${submission.id}`).status(200).send();
};

export const remove = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const { viewer } = req;
  if (!viewer) {
    res.status(401).send();
    return;
  }

  const done = await attempt(res, { submissionId: submission.id, by: viewer.id }, () =>
    lifecycle.deleteSubmission(callerFor(viewer), submission.id)
  );
  if (!done.ran) {
    return;
  }

  res.set("HX-Redirect", "/").send();
};

/**
 * GET /submissions/:id/edit-media
 * Renders form for editing photos and video on approved submissions (owner only)
 */
export const renderEditMedia = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const submission = await validateSubmission(req, res);

  if (!submission) {
    return;
  }

  if (!viewer) {
    res.status(401).send();
    return;
  }

  // Only owner can edit media
  if (viewer.id !== submission.member_id) {
    res.status(403).send("You can only edit media on your own submissions");
    return;
  }

  // Only approved submissions
  if (!submission.approved_on) {
    res.status(400).send("You can only edit media on approved submissions");
    return;
  }

  // Fetch images from normalized table
  const images = await getSubmissionImages(submission.id);

  res.render("submission/editMedia", {
    title: "Edit Photos & Video",
    submission,
    form: {
      id: submission.id,
      images: JSON.stringify(images),
      video_url: submission.video_url || "",
    },
  });
};

/**
 * PATCH /submissions/:id/media
 * Updates photos and video URL on approved submissions (owner only)
 */
export const updateMedia = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const submission = await validateSubmission(req, res);

  if (!submission) {
    return;
  }

  if (!viewer) {
    res.status(401).send();
    return;
  }

  // Only owner can edit media
  if (viewer.id !== submission.member_id) {
    res.status(403).send("You can only edit media on your own submissions");
    return;
  }

  // Only approved submissions
  if (!submission.approved_on) {
    res.status(400).send("You can only edit media on approved submissions");
    return;
  }

  // Get video_url from form
  // Note: Images are managed via /api/upload endpoints, not this form
  const video_url = getBodyString(req, "video_url", "");

  // Validate video URL if provided
  const trimmedVideoUrl = video_url.trim();
  if (trimmedVideoUrl !== "") {
    try {
      new URL(trimmedVideoUrl);
    } catch {
      res.status(400).send("Invalid video URL format");
      return;
    }
  }

  // Update only video_url (images managed via /api/upload endpoints)
  await db.updateSubmission(submission.id, {
    video_url: trimmedVideoUrl || null,
  });

  // Redirect back to submission view
  res.set("HX-Redirect", `/submissions/${submission.id}`).status(200).send();
};

/**
 * GET /api/video/preview?url=VIDEO_URL
 * Returns a preview card for a video URL (validates, fetches metadata, renders HTML)
 */
export const videoPreview = async (req: MulmRequest, res: Response) => {
  const url = req.query.url as string;

  // Validate URL
  if (!url || typeof url !== "string") {
    res.status(400).send("");
    return;
  }

  // Check if it's a valid video URL
  if (!isValidVideoUrl(url)) {
    res.render("bapForm/videoPreviewError", {
      error: "Please enter a valid YouTube or Vimeo URL",
    });
    return;
  }

  try {
    // Fetch video metadata with oEmbed
    const metadata = await parseVideoUrlWithOEmbed(url);

    if (metadata.platform === "unknown" || !metadata.videoId) {
      res.render("bapForm/videoPreviewError", {
        error: "Could not parse video URL. Please check the link and try again.",
      });
      return;
    }

    // Render preview card
    res.render("bapForm/videoPreview", {
      metadata,
    });
  } catch {
    res.render("bapForm/videoPreviewError", {
      error: "Failed to load video preview. The link may be invalid or the video may be private.",
    });
  }
};

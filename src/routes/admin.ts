import {
  createMember,
  getMember,
  getMemberByEmail,
  getRosterWithPoints,
  getMemberWithPoints,
  updateMember,
  hasLoginCredential,
} from "@/db/members";
import {
  getApprovedSince,
  getQueue,
  getQueueCounts,
  getSubmissionById,
  getSubmissionsByMember,
  type QueueSubmission,
  type Submission,
} from "@/db/submissions";
import { approveForm } from "@/forms/approve";
import { editApprovedDetailsForm } from "@/forms/editApprovedDetails";
import { bindSpeciesForm } from "@/forms/bindSpecies";
import {
  chosenSpeciesForm,
  confirmWitnessSchema,
  recordSpeciesDraftForm,
  recordSpeciesForm,
  witnessSummaryForm,
} from "@/forms/confirmWitness";
import { correctPointsSchema } from "@/forms/correctPoints";
import { z } from "zod";
import { inviteSchema } from "@/forms/member";
import { sendInviteEmail } from "@/notifications";
import { getNextLevel, isProgramType, programMetadata, programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { createAuthCode } from "@/db/auth";
import { AuthCode, generateRandomCode } from "@/auth";
import { validateFormResult } from "@/forms/utils";
import {
  CORRECTION_BUTTON,
  correctionPanelLocals,
  programOfSubmission,
  validateSubmission,
  witnessPanelLocals,
  witnessSummary,
} from "./submission";
import {
  isLivestock,
  foodTypes,
  spawnLocations,
  hasLighting,
  hasSupplements,
  hasFoods,
  hasSpawnLocations,
} from "@/forms/submission";
import {
  canonicalName as canonicalNameOf,
  countApprovedBySpecies,
  countSubmissionsOfSpecies,
  findSpeciesById,
  findSpeciesByName,
  listNames,
} from "@/species";
import { findSubmissionsWithRecordedSpecies } from "@/db/submission_notes";
import { programOfSpeciesType } from "@/points";
import { formatShortDate } from "@/utils/dateFormat";
import { getBodyString } from "@/utils/request";
import { checkAllMemberLevels } from "@/levelManager";
import { checkAllSpecialtyAwards } from "@/specialtyAwardManager";
import { logger } from "@/utils/logger";
import { getStatusPresentation } from "@/utils/statusBadge";
import * as lifecycle from "@/lifecycle";
import { callerFor, sendLifecycleError } from "./lifecycleErrors";
import {
  addNote,
  getNotesForSubmission,
  updateNote,
  deleteNote,
  getNoteById,
} from "@/db/submission_notes";
import { submissionNoteForm } from "@/forms/submissionNote";
import { getLiveCTAMessage, updateLiveCTAMessage } from "@/db/settings";
import { marked } from "marked";


export function requireAdmin(req: MulmRequest, res: Response, next: NextFunction) {
  if (!req.viewer) {
    res.status(401).send();
    return;
  } else if (!req.viewer?.is_admin) {
    res.status(403).send();
    return;
  } else {
    next();
  }
}

export const viewMembers = async (req: MulmRequest, res: Response) => {
  const members = await getRosterWithPoints();

  // Import level utilities for member points HoverCards

  res.render("admin/members", {
    title: "Member Roster",
    members,
    getNextLevel,
    programMetadata,
  });
};

export const viewMemberUpdate = async (req: MulmRequest, res: Response) => {
  const { memberId } = req.params;
  const id = parseInt(memberId);
  if (isNaN(id)) {
    res.status(422).send("Invalid member ID");
    return;
  }
  const memberWithPoints = await getMemberWithPoints(id);

  // Import level utilities for member points HoverCards

  // Render one table row for editing
  res.render("admin/editMember", {
    member: memberWithPoints,
    getNextLevel,
    programMetadata,
  });
};

export const viewMemberRow = async (req: MulmRequest, res: Response) => {
  const { memberId } = req.params;
  const id = parseInt(memberId);
  if (isNaN(id)) {
    res.status(422).send("Invalid member ID");
    return;
  }
  const memberWithPoints = await getMemberWithPoints(id);

  // Import level utilities for member points HoverCards

  res.render("admin/singleMemberRow", {
    member: memberWithPoints,
    getNextLevel,
    programMetadata,
  });
};

export const updateMemberFields = async (req: MulmRequest, res: Response) => {
  const { memberId } = req.params;
  const id = parseInt(memberId);
  if (isNaN(id)) {
    res.status(422).send("Invalid member ID");
    return;
  }

  // Parse only the editable fields (name, email, admin status)
  const { display_name, contact_email, is_admin } = req.body as {
    display_name: string;
    contact_email: string;
    is_admin?: string;
  };
  await updateMember(id, {
    display_name,
    contact_email,
    is_admin: is_admin !== undefined ? 1 : 0,
  });

  // Get the updated member with total points
  const memberWithPoints = await getMemberWithPoints(id);

  // Import level utilities for member points HoverCards

  res.render("admin/singleMemberRow", {
    member: memberWithPoints,
    getNextLevel,
    programMetadata,
  });
};

/** How long after an approval it still counts as tonight's, on the queue page. */
const TONIGHT_HOURS = 12;

/** A row of the approval queue's "Ready to approve", as queue.pug shows it. */
export type ReadyRow = {
  id: number;
  member_id: number;
  member_name: string;
  /** The member's first name, for "Tap again: Jane brought it". */
  firstName: string;
  program: string;
  programShort: string;
  /** The bound Species' common Name, or its Canonical name when it has none; the member's spelling only when unbound. */
  species_common_name: string;
  /** The bound Species' Canonical name, which is the common one again when it has no common Name. */
  species_latin_name: string;
  /** The witness recorded the Species because the catalogue lacked it (#522). */
  newSpecies: boolean;
  /** What approving would award now, first-time included. */
  preview: lifecycle.ApprovalPreview;
  witnessedOn: string;
  /** The viewer's own: another committee member approves it. */
  mine: boolean;
};

/** A row of "Approved tonight". */
export type ApprovedRow = {
  id: number;
  member_name: string;
  species_common_name: string;
  programShort: string;
  total: number;
  approvedBy: string | null;
};

/** A row of "Still waiting". */
export type WaitingRow = {
  id: number;
  member_name: string;
  species_common_name: string;
  programShort: string;
  readyOn: string;
};

const PROGRAM_SHORT: Record<string, string> = { fish: "BAP", plant: "HAP", coral: "CAP" };

/**
 * The names a queue row shows (#527): the bound Species' common Name and
 * Canonical name, which are what the witness settled, not the member's
 * spelling. A Species with no common Name goes by its Canonical name alone;
 * an unbound row has only the member's spelling to show.
 */
function speciesNamesOf(
  row: Pick<QueueSubmission, "species_common_name" | "species_latin_name" | "bound_species_name" | "bound_common_name">
): { common: string; latin: string } {
  if (!row.bound_species_name) {
    return { common: row.species_common_name, latin: row.species_latin_name };
  }
  return { common: row.bound_common_name ?? row.bound_species_name, latin: row.bound_species_name };
}

/** The path this queue page lives at, which the approve button's redirect and the sheet's "Not now" return to. */
function queuePath(program: string | null): string {
  return program ? `/admin/queue/${program}` : "/admin/queue";
}

/**
 * The approval queue's locals (#527): every Program's rows in one list, or
 * one Program's when `program` is given. Ready rows carry the preview the
 * approve button posts the total of; the rows of every Program are read in
 * one query each, and first-time is counted for the page in one more.
 */
export async function approvalQueueLocals(viewer: NonNullable<MulmRequest["viewer"]>, program: string | null) {
  const listed = program ? [program] : [...programs];
  const since = new Date(Date.now() - TONIGHT_HOURS * 60 * 60 * 1000).toISOString();
  const [readyByProgram, waitingByProgram, approvedRows, readyCounts] = await Promise.all([
    Promise.all(listed.map((p) => getQueue("approval", p))),
    Promise.all(listed.map((p) => getQueue("waitingPeriod", p))),
    getApprovedSince(since, program ?? undefined),
    getQueueCounts("approval"),
  ]);
  const readyRows = readyByProgram.flat();
  const [approvedBefore, recorded] = await Promise.all([
    countApprovedBySpecies(readyRows.map((row) => row.species_id).filter((id): id is number => id != null)),
    findSubmissionsWithRecordedSpecies(readyRows.map((row) => row.id)),
  ]);

  const short = (row: Pick<QueueSubmission, "program">) => PROGRAM_SHORT[row.program] ?? row.program;
  const ready: ReadyRow[] = readyRows.map((row) => ({
    id: row.id,
    member_id: row.member_id,
    member_name: row.member_name,
    firstName: row.member_name.trim().split(/\s+/)[0] || row.member_name,
    program: row.program,
    programShort: short(row),
    species_common_name: speciesNamesOf(row).common,
    species_latin_name: speciesNamesOf(row).latin,
    newSpecies: recorded.has(row.id),
    preview: lifecycle.previewApproval(row, row.species_id == null ? 0 : (approvedBefore.get(row.species_id) ?? 0)),
    witnessedOn: formatShortDate(row.witnessed_on),
    mine: row.member_id === viewer.id,
  }));
  const approvedTonight: ApprovedRow[] = approvedRows.map((row) => ({
    id: row.id,
    member_name: row.member_name,
    species_common_name: speciesNamesOf(row).common,
    programShort: short(row),
    total: row.total_points ?? 0,
    approvedBy: row.approved_by_name ?? null,
  }));
  // Soonest ready first
  const waitingRows = waitingByProgram
    .flat()
    .map((row) => ({ row, endsOn: lifecycle.waitingPeriodEndsOn(row) }))
    .sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  const waiting: WaitingRow[] = waitingRows.map(({ row, endsOn }) => ({
    id: row.id,
    member_name: row.member_name,
    species_common_name: speciesNamesOf(row).common,
    programShort: short(row),
    readyOn: formatShortDate(endsOn),
  }));

  const counts = {
    all: Object.values(readyCounts).reduce((sum, n) => sum + n, 0),
    fish: readyCounts.fish ?? 0,
    plant: readyCounts.plant ?? 0,
    coral: readyCounts.coral ?? 0,
  };

  return {
    title: "Approval queue",
    subtitle: program !== null && isProgramType(program) ? programMetadata[program].name : "Every Program",
    program,
    queuePath: queuePath(program),
    ready,
    approvedTonight,
    waiting,
    counts,
  };
}

/**
 * GET /admin/queue{/:program}
 * The approval queue at a meeting, phone first: ready to approve, approved
 * tonight, still waiting. With no Program every Program's rows are listed,
 * since a meeting has fish, plants and corals on the table together.
 */
export const showQueue = async (req: MulmRequest, res: Response) => {
  const program = req.params.program ?? null;
  if (program && programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  res.render("admin/queue", await approvalQueueLocals(req.viewer!, program));
};

export const showWitnessQueue = async (req: MulmRequest, res: Response) => {
  const { program = "fish" } = req.params;
  if (programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  const [submissions, programCounts] = await Promise.all([
    getQueue("witness", program),
    getQueueCounts("witness"),
  ]);

  // Add status info to each submission
  const submissionsWithStatus = submissions.map((sub) => ({
    ...sub,
    statusInfo: getStatusPresentation(sub),
  }));

  const subtitle = (() => {
    switch (program) {
      default:
      case "fish":
        return `Breeder Awards Program`;
      case "plant":
        return `Horticultural Awards Program`;
      case "coral":
        return `Coral Awards Program`;
    }
  })();

  res.render("admin/witnessQueue", {
    title: "Screening Queue",
    subtitle,
    submissions: submissionsWithStatus,
    program,
    programCounts,
  });
};

export const showWaitingPeriod = async (req: MulmRequest, res: Response) => {
  const { program = "fish" } = req.params;
  if (programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  // Everything screened whose clock has not run. The approval queue is a
  // different page, and the clock alone decides which of the two a witnessed
  // Submission is on.
  const [waiting, programCounts, witnessCounts] = await Promise.all([
    getQueue("waitingPeriod", program),
    getQueueCounts("approval"),
    getQueueCounts("witness"),
  ]);

  const submissionsWithStatus = waiting.map((sub) => ({
    ...sub,
    waitingStatus: lifecycle.waitingPeriod(sub),
  }));

  const subtitle = (() => {
    switch (program) {
      default:
      case "fish":
        return `Breeder Awards Program`;
      case "plant":
        return `Horticultural Awards Program`;
      case "coral":
        return `Coral Awards Program`;
    }
  })();

  res.render("admin/waitingPeriod", {
    title: "Auction Eligibility Monitor",
    subtitle,
    submissions: submissionsWithStatus,
    program,
    programCounts,
    witnessCounts,
  });
};

export const sendRequestChanges = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  try {
    await lifecycle.requestChanges(
      { id: req.viewer!.id, isAdmin: true },
      submission.id,
      getBodyString(req, "content")
    );
  } catch (err) {
    if (sendLifecycleError(res, err, { submissionId: submission.id, adminId: req.viewer?.id })) {
      return;
    }
    logger.error("Error sending request changes:", err);
    res.status(500).send("Failed to request changes. Please try again.");
    return;
  }

  // Redirect to approval queue for the submission's program
  res.set("HX-Redirect", `/admin/queue/${submission.program}`).send();
};

export const requestChangesForm = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    res.send("Error: submission not found");
    return;
  }

  const contents = `
Changes are requested from your BAP submission. Please review the notes below, make appropriate changes, and resubmit.

-----------------

Water Type: ${submission.water_type}
Species Class: ${submission.species_class}
Common Name: ${submission.species_common_name}
Latin Name: ${submission.species_latin_name}

Date: ${submission.reproduction_date}
Spawn Locations: ${(JSON.parse(submission.spawn_locations) as string[]).join(", ")}
Foods: ${(JSON.parse(submission.foods) as string[]).join(", ")}

Tank Size: ${submission.tank_size}
Filter Type: ${submission.filter_type}
Water Change:
	- Volume: ${submission.water_change_volume}
	- Frequency: ${submission.water_change_frequency}
Temperature: ${submission.temperature}
pH: ${submission.ph}
Hardness: ${submission.gh}
Specific Gravity: ${submission.specific_gravity}
Substrate:
	- Type: ${submission.substrate_type}
	- Depth: ${submission.substrate_depth}
	- Color: ${submission.substrate_color}
`;
  res.render("admin/requestChanges", {
    submission,
    contents,
  });
};

/**
 * Run a witness-panel move (binding a Species, confirming the Witness) and
 * show a refusal in the panel's own alert. HTMX does not swap a 4xx body, so
 * a refusal sent as one reached nobody; this retargets `#committee-error`.
 * @returns whether the move ran; if not, the response has been sent
 */
async function witnessPanelMove(
  req: MulmRequest,
  res: Response,
  submissionId: number,
  move: () => Promise<void>
): Promise<boolean> {
  try {
    await move();
    return true;
  } catch (err) {
    if (!lifecycle.isLifecycleError(err)) throw err;
    logger.warn(`Witness panel refusal: ${err.message}`, { submissionId, adminId: req.viewer?.id });
    sendWitnessPanelRefusal(res, [err.message]);
    return false;
  }
}

function sendWitnessPanelRefusal(res: Response, messages: string[]): void {
  res.set("HX-Retarget", "#committee-error").set("HX-Reswap", "innerHTML");
  res.render("admin/witnessErrors", { messages });
}

/**
 * The Program a Submission has once the Witness is confirmed: its chosen
 * Species' Program, since the confirm adopts it. When the form names no
 * Species that exists, the witness is recording one, which takes the
 * Submission's type, so the Submission's own Program stands; the schema
 * refuses a species_id that is wrong anyway.
 */
async function programAfterConfirm(body: unknown, submission: Pick<Submission, "program" | "species_type">): Promise<string> {
  const chosen = chosenSpeciesForm.safeParse(body);
  const species =
    chosen.success && chosen.data.species_id !== undefined ? await findSpeciesById(chosen.data.species_id) : undefined;
  return species ? programOfSpeciesType(species.species_type) : programOfSubmission(submission);
}

/**
 * POST /admin/submissions/:id/confirm-witness
 * The witness panel's confirm: the Species the witness settled on, the base
 * points and bonuses, and which spellings become Names, validated against
 * the Program that Species belongs to and written in the Witness's one
 * transaction.
 */
export const confirmWitnessAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const body: unknown = req.body ?? {};
  const parsed = confirmWitnessSchema(await programAfterConfirm(body, submission)).safeParse(body);
  if (!parsed.success) {
    sendWitnessPanelRefusal(res, parsed.error.issues.map((issue) => issue.message));
    return;
  }

  const { species_id, new_species, points, article_points, cares_species, flowered, sexual_reproduction } = parsed.data;
  const ran = await witnessPanelMove(req, res, submission.id, () =>
    lifecycle.confirmWitness(
      callerFor(req.viewer!),
      submission.id,
      { species_id, new_species, points, article_points, cares_species, flowered, sexual_reproduction },
      { common: parsed.data.add_common_name, scientific: parsed.data.add_scientific_name }
    )
  );
  if (!ran) return;

  // The confirm gives the Submission its Species' Program, so the queue to
  // return to is the settled one, read after the write, not the one it was
  // filed under
  const settled = await getSubmissionById(submission.id);
  res.set("HX-Redirect", `/admin/witness-queue/${settled?.program ?? submission.program}`).send();
};

/** Whether a witness-panel request belongs to the correction form (#528): it says so in a `correction` field. */
function isCorrection(source: unknown): boolean {
  const parsed = z.object({ correction: z.string().optional() }).safeParse(source);
  return parsed.success && parsed.data.correction === "1";
}

/**
 * The Record new species step, into the panel's Species card. On the
 * correction form the step carries its flag and goes back to the form, not
 * the Submission page.
 */
function renderRecordSpeciesForm(
  res: Response,
  submission: Submission,
  values: Record<string, unknown>,
  errors: Map<string, string>,
  correction: boolean,
  existing: ExistingSpeciesFacts | null = null
): void {
  res.render("admin/recordSpeciesForm", {
    submission,
    program: programOfSubmission(submission),
    values,
    errors,
    correction,
    existing,
    backUrl: correction ? `/admin/submissions/${submission.id}/correct-points` : `/submissions/${submission.id}`,
  });
}

/** The Species that already holds the scientific name the witness tried to record, as the step offers it with This one. */
type ExistingSpeciesFacts = { speciesId: number; speciesName: string; commonName: string | null };

/**
 * The Species the catalogue already lists under this scientific name, or
 * null: the lookup `createSpecies` refuses on, asked before the step accepts
 * the name, so the witness hears it here, beside the field, and not after
 * choosing the points. The confirm's transaction checks it again.
 */
async function speciesAlreadyNamed(scientificName: string): Promise<ExistingSpeciesFacts | null> {
  const [species] = await findSpeciesByName(scientificName, "scientific");
  if (!species) return null;
  const names = await listNames(species.group_id);
  return { speciesId: species.group_id, speciesName: canonicalNameOf(species), commonName: names.common[0]?.name ?? null };
}

/**
 * GET /admin/submissions/:id/record-species
 * The witness panel's Record new species step (#522): the names prefilled
 * from the member's spelling, the Submission's type and class, and the Point
 * class and CARES flag to choose. Nothing is created here.
 */
export const recordSpeciesFormAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  renderRecordSpeciesForm(
    res,
    submission,
    {
      new_scientific_name: submission.species_latin_name,
      new_common_name: submission.species_common_name,
      new_point_class: null,
      new_cares_species: false,
    },
    new Map(),
    isCorrection(req.query)
  );
};

/**
 * POST /admin/submissions/:id/record-species
 * Record species and continue: the step's values checked, then the whole
 * panel again with the new Species settled and the Points card prefilled from
 * its Point class and CARES flag. The Species itself is created only by the
 * confirm, in the Witness's transaction, so leaving the page creates nothing.
 * A refusal re-renders the step with its errors beside the fields.
 */
export const recordSpeciesAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const body: unknown = req.body ?? {};
  const correction = isCorrection(body);
  const parsed = recordSpeciesForm.safeParse(body);
  if (!parsed.success) {
    const typed = recordSpeciesDraftForm.parse(body);
    renderRecordSpeciesForm(
      res,
      submission,
      typed,
      new Map(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])),
      correction
    );
    return;
  }

  // A name the catalogue holds is refused here, where the witness can tap
  // This one on the Species that holds it, not after the points are chosen
  const existing = await speciesAlreadyNamed(`${parsed.data.canonicalGenus} ${parsed.data.canonicalSpeciesName}`);
  if (existing) {
    const listedAs = existing.commonName ? `${existing.commonName}, ${existing.speciesName}` : existing.speciesName;
    renderRecordSpeciesForm(
      res,
      submission,
      recordSpeciesDraftForm.parse(body),
      new Map([["new_scientific_name", `The catalogue already has this species (${listedAs}). Tap This one to choose it.`]]),
      correction,
      existing
    );
    return;
  }

  const panel = correction
    ? await correctionPanelLocals(submission, req.viewer!, { newSpecies: parsed.data })
    : await witnessPanelLocals(submission, req.viewer!, { newSpecies: parsed.data });
  res.set("HX-Retarget", "#witnessPanel").set("HX-Reswap", "outerHTML");
  res.render("admin/witnessPanel", {
    submission: { ...submission, reproduction_date: formatShortDate(submission.reproduction_date) },
    ...panel,
  });
};

/**
 * POST /admin/submissions/:id/witness-summary
 * The witness panel's sticky bar, re-summed on the server from the form as it
 * stands: the one Points rule, not a copy of it in the browser.
 */
export const witnessSummaryAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const parsed = witnessSummaryForm.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).send(parsed.error.issues.map((issue) => issue.message).join("; "));
    return;
  }

  const { species_id, new_scientific_name: recording, correction, ...values } = parsed.data;
  res.render("admin/witnessSummary", {
    // A Species being recorded counts as chosen, as does one bound or picked
    summary: witnessSummary({ ...values, bound: recording || (species_id ?? submission.species_id) != null }),
    summaryButton: correction ? CORRECTION_BUTTON : null,
  });
};

/** The correction form's query: a Species chosen on the form, as the picker (`group_id`) or a suggestion (`species_id`) names it. */
const chosenOnCorrectionForm = z
  .object({
    species_id: z.coerce.number().int().positive().optional(),
    group_id: z.coerce.number().int().positive().optional(),
  })
  .transform((val) => val.species_id ?? val.group_id);

/**
 * Whether this viewer may correct this Submission at all (#528): the table's
 * answer with the Species taken as settled, since the form itself lets the
 * corrector choose one for a Submission bound to none.
 */
function mayCorrect(viewer: NonNullable<MulmRequest["viewer"]>, submission: Submission): boolean {
  const isOwner = submission.member_id === viewer.id;
  return lifecycle.canMove(lifecycle.moves.correctPoints, {
    state: lifecycle.deriveState(submission),
    changesPending: lifecycle.hasChangesRequested(submission),
    actor: isOwner ? "member" : "committee",
    actorId: viewer.id,
    isOwner,
    bound: true,
  });
}

/**
 * GET /admin/submissions/:id/correct-points{?species_id|group_id}
 * The correction form (#528): the witness panel's Species and Points cards
 * over the Submission's current values, a required reason and Save
 * correction. As a page from the Submission page or the approval queue; as
 * the panel alone when the form itself asks for it again with another
 * Species chosen, so the base points prefill from that Species' Point class.
 * Nothing is written until Save.
 */
export const correctPointsFormAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  if (!mayCorrect(req.viewer!, submission)) {
    res.status(403).send("This Submission's points cannot be corrected by you now: it needs a Witness first, or it is your own.");
    return;
  }

  const chosen = chosenOnCorrectionForm.safeParse(req.query);
  const speciesId = chosen.success ? chosen.data : undefined;
  if (speciesId !== undefined && !(await findSpeciesById(speciesId))) {
    sendWitnessPanelRefusal(res, ["Choose a Species that exists"]);
    return;
  }

  const panel = await correctionPanelLocals(submission, req.viewer!, { speciesId });
  const locals = {
    title: "Correct species and points",
    submission: { ...submission, reproduction_date: formatShortDate(submission.reproduction_date) },
    ...panel,
  };
  if (req.get("HX-Request") === "true") {
    res.render("admin/witnessPanel", locals);
    return;
  }
  res.render("admin/correctPoints", locals);
};

/**
 * POST /admin/submissions/:id/correct-points
 * Save correction: the Species, the points, first-time on an Approved
 * Submission, and the reason, validated against the Program the chosen
 * Species belongs to and written in one transaction with one changelog
 * entry. A refusal lands in the panel's alert; success returns to the
 * Submission page.
 */
export const correctPointsAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const body: unknown = req.body ?? {};
  const approved = submission.approved_on != null;
  const parsed = correctPointsSchema(await programAfterConfirm(body, submission), { approved }).safeParse(body);
  if (!parsed.success) {
    sendWitnessPanelRefusal(res, parsed.error.issues.map((issue) => issue.message));
    return;
  }

  const { reason, ...correction } = parsed.data;
  const ran = await witnessPanelMove(req, res, submission.id, async () => {
    await lifecycle.correctPoints(callerFor(req.viewer!), submission.id, correction, reason);
  });
  if (!ran) return;

  res.set("HX-Redirect", `/submissions/${submission.id}`).send();
};

/**
 * POST /admin/submissions/:id/bind-species
 * The witness panel binds (or rebinds) the Submission to the Species picked in
 * the catalogue typeahead, then the page reloads to show it bound.
 */
export const bindSpeciesAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const parsed = bindSpeciesForm.safeParse(req.body);
  if (!parsed.success) {
    sendWitnessPanelRefusal(res, parsed.error.issues.map((issue) => issue.message));
    return;
  }

  const ran = await witnessPanelMove(req, res, submission.id, () =>
    lifecycle.bindSpecies(callerFor(req.viewer!), submission.id, parsed.data.group_id)
  );
  if (!ran) return;

  res.set("HX-Refresh", "true").send();
};

/**
 * POST /admin/submissions/:id/adopt-species-classification
 * The witness panel's one click on a mismatch: the Submission takes its bound
 * Species' Species type and Program class, then the page reloads.
 */
export const adoptSpeciesClassificationAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  const ran = await witnessPanelMove(req, res, submission.id, () =>
    lifecycle.adoptSpeciesClassification(callerFor(req.viewer!), submission.id)
  );
  if (!ran) return;

  res.set("HX-Refresh", "true").send();
};

export const inviteMember = async (req: MulmRequest, res: Response) => {
  const errors = new Map<string, string>();
  const renderDialog = () => {
    res.render("admin/inviteUser", {
      ...(req.body as object),
      errors,
    });
  };

  const parsed = inviteSchema.safeParse(req.body);
  if (!validateFormResult(parsed, errors, renderDialog)) {
    return;
  }
  const { contact_email, display_name } = parsed.data;
  let member = await getMemberByEmail(contact_email);
  if (member == undefined) {
    const name = String(display_name);
    if (name.length > 2) {
      const member_id = await createMember(parsed.data.contact_email, name);
      member = await getMember(member_id);
    }

    if (!member) {
      res.send("Failed to create member");
      return;
    }
  }

  const codeEntry: AuthCode = {
    member_id: member.id,
    code: generateRandomCode(24),
    // 1 week expiration
    expires_on: new Date(Date.now() + 60 * 60 * 1000 * 24 * 7),
    purpose: "password_reset",
  };

  await createAuthCode(codeEntry);
  await sendInviteEmail(contact_email, member.display_name, codeEntry.code);
  res.send("Invite sent");
};

export const sendWelcomeEmail = async (req: MulmRequest, res: Response) => {
  const { memberId } = req.params;
  const id = parseInt(memberId);
  if (isNaN(id)) {
    res.status(422).send("Invalid member ID");
    return;
  }

  try {
    const member = await getMember(id);
    if (!member) {
      res.status(404).send("Member not found");
      return;
    }

    if (await hasLoginCredential(member.id)) {
      res.status(400).send("Member already has login credentials");
      return;
    }

    // Create auth code for password setup
    const codeEntry: AuthCode = {
      member_id: member.id,
      code: generateRandomCode(24),
      // 1 week expiration
      expires_on: new Date(Date.now() + 60 * 60 * 1000 * 24 * 7),
      purpose: "password_reset",
    };

    // Fetch approved submissions for the email
    const submissions = await getSubmissionsByMember(
      member.id,
      false, // don't include unsubmitted
      false // don't include unapproved
    );

    await createAuthCode(codeEntry);
    await sendInviteEmail(
      member.contact_email,
      member.display_name,
      codeEntry.code,
      member,
      submissions
    );

    // Return updated member row
    const memberWithPoints = await getMemberWithPoints(member.id);
    res.render("admin/singleMemberRow", {
      member: memberWithPoints,
      getNextLevel,
      programMetadata,
    });
  } catch (error) {
    logger.error("Error sending welcome email:", error);
    res.status(500).send("Failed to send welcome email. Please try again.");
  }
};

/**
 * The sheet the approve button's refusals come back as, swapped over the
 * queue page's `#approve-sheet` placeholder: the fresh total when the points
 * changed, or what was refused and why.
 */
function renderApproveSheet(
  res: Response,
  submission: Submission,
  sheet: { preview: lifecycle.ApprovalPreview; expectedTotal: number } | { message: string }
): void {
  res.set("HX-Retarget", "#approve-sheet").set("HX-Reswap", "outerHTML");
  res.render("admin/approveSheet", {
    submission,
    queuePath: queuePathFrom(res.req),
    ...("preview" in sheet ? { preview: sheet.preview, expectedTotal: sheet.expectedTotal, message: null } : { preview: null, expectedTotal: null, message: sheet.message }),
  });
}

/** The queue page the request came from, so the approver lands back where they were. */
function queuePathFrom(req: MulmRequest): string {
  const current = req.get("HX-Current-URL");
  if (current) {
    try {
      const { pathname } = new URL(current);
      if (pathname === "/admin/queue" || pathname.startsWith("/admin/queue/")) return pathname;
    } catch {
      // Not a URL: fall through to the whole queue
    }
  }
  return "/admin/queue";
}

/**
 * POST /admin/submissions/:id/approve
 * The one button (#527): the body carries only the total the button showed.
 * The lifecycle computes first-time and awards the points the Witness set,
 * or refuses; a stale total comes back as a sheet with the current one.
 */
export const approveSubmission = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  const submission = await validateSubmission(req, res);
  if (!submission) return;
  const id = submission.id;

  const parsed = approveForm.safeParse(req.body);
  if (!parsed.success) {
    renderApproveSheet(res, submission, { message: "The page did not say what total it showed. Reload the queue and try again." });
    return;
  }

  // Approving is the only way Points are ever awarded. Everything that follows
  // from it - the member's email, the feed entry, the Level and Specialty
  // Award recompute - hangs off the transition, not off this handler.
  try {
    await lifecycle.approve(callerFor(viewer!), id, parsed.data.expected_total);
  } catch (err) {
    if (err instanceof lifecycle.StalePointsError) {
      logger.warn("Approval refused: the points changed", { submissionId: id, adminId: viewer?.id, ...err.context });
      const approvedBefore = submission.species_id == null ? 0 : (await countSubmissionsOfSpecies(submission.species_id)).approved;
      renderApproveSheet(res, submission, {
        preview: lifecycle.previewApproval(submission, approvedBefore),
        expectedTotal: parsed.data.expected_total,
      });
      return;
    }
    if (lifecycle.isLifecycleError(err)) {
      logger.warn(`Approval refused: ${err.message}`, { submissionId: id, adminId: viewer?.id });
      renderApproveSheet(res, submission, { message: err.message });
      return;
    }
    throw err;
  }

  res.set("HX-Redirect", queuePathFrom(req)).send();
};

export const checkMemberLevels = async (req: MulmRequest, res: Response) => {
  const memberId = parseInt(req.params.memberId);
  if (!memberId) {
    res.status(400).json({ error: "Invalid member ID" });
    return;
  }

  try {
    const results = await checkAllMemberLevels(memberId);
    const levelChanges = Object.entries(results)
      .filter(([, result]) => result.levelChanged)
      .map(([program, result]) => ({
        program,
        oldLevel: result.oldLevel,
        newLevel: result.newLevel,
      }));

    res.json({
      success: true,
      memberId,
      levelChanges,
      message:
        levelChanges.length > 0
          ? `Updated ${levelChanges.length} level(s) for member ${memberId}`
          : `No level changes needed for member ${memberId}`,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to check member levels",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const checkMemberSpecialtyAwards = async (req: MulmRequest, res: Response) => {
  const memberId = parseInt(req.params.memberId);
  if (!memberId) {
    res.status(400).json({ error: "Invalid member ID" });
    return;
  }

  try {
    const newAwards = await checkAllSpecialtyAwards(memberId);

    res.json({
      success: true,
      memberId,
      newAwards,
      totalNewAwards: newAwards.length,
      message:
        newAwards.length > 0
          ? `Granted ${newAwards.length} new specialty award(s) for member ${memberId}: ${newAwards.join(", ")}`
          : `No new specialty awards for member ${memberId}`,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to check member specialty awards",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * POST /admin/submissions/:id/notes
 * Add an admin note to a submission
 */
export async function addSubmissionNote(req: MulmRequest, res: Response) {
  // Auth already verified by requireAdmin middleware
  const { viewer } = req;
  const submissionId = parseInt(req.params.id);

  if (!submissionId) {
    res.status(400).send("Invalid submission ID");
    return;
  }

  // Validate form
  const parsed = submissionNoteForm.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).send("Invalid note: " + parsed.error.issues[0].message);
    return;
  }

  try {
    // Add the note
    const noteId = await addNote(submissionId, viewer!.id, parsed.data.note_text);

    // Fetch the newly created note with admin details
    const notes = await getNotesForSubmission(submissionId);
    const newNote = notes.find((n) => n.id === noteId);

    if (!newNote) {
      res.status(500).send("Note created but could not be retrieved");
      return;
    }

    // Render just the new note HTML for HTMX to insert
    res.render("admin/submissionNote", {
      note: newNote,
    });
  } catch (error) {
    logger.error("Failed to add submission note", error);
    res.status(500).send("Failed to add note");
  }
}

/**
 * PATCH /admin/submissions/:submissionId/notes/:noteId
 * Update an existing admin note
 */
export async function updateSubmissionNote(req: MulmRequest, res: Response) {
  const noteId = parseInt(req.params.noteId);

  if (!noteId) {
    res.status(400).send("Invalid note ID");
    return;
  }

  // Verify the note exists
  const note = await getNoteById(noteId);
  if (!note) {
    res.status(404).send("Note not found");
    return;
  }

  // Validate form
  const parsed = submissionNoteForm.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).send("Invalid note: " + parsed.error.issues[0].message);
    return;
  }

  try {
    // Update the note
    await updateNote(noteId, parsed.data.note_text);

    // Fetch the updated note
    const updatedNote = await getNoteById(noteId);
    if (!updatedNote) {
      res.status(500).send("Note updated but could not be retrieved");
      return;
    }

    // Render the updated note HTML
    res.render("admin/submissionNote", {
      note: updatedNote,
    });
  } catch (error) {
    logger.error("Failed to update submission note", error);
    res.status(500).send("Failed to update note");
  }
}

/**
 * DELETE /admin/submissions/:submissionId/notes/:noteId
 * Delete an admin note
 */
export async function deleteSubmissionNote(req: MulmRequest, res: Response) {
  const noteId = parseInt(req.params.noteId);

  if (!noteId) {
    res.status(400).send("Invalid note ID");
    return;
  }

  // Verify the note exists
  const note = await getNoteById(noteId);
  if (!note) {
    res.status(404).send("Note not found");
    return;
  }

  try {
    await deleteNote(noteId);
    res.status(200).send(""); // Return empty response for HTMX to remove the element
  } catch (error) {
    logger.error("Failed to delete submission note", error);
    res.status(500).send("Failed to delete note");
  }
}

/**
 * GET /admin/submissions/:submissionId/notes/:noteId/edit
 * Render the edit form for a note
 */
export async function editSubmissionNoteForm(req: MulmRequest, res: Response) {
  const noteId = parseInt(req.params.noteId);
  if (!noteId) {
    res.status(400).send("Invalid note ID");
    return;
  }

  const note = await getNoteById(noteId);
  if (!note) {
    res.status(404).send("Note not found");
    return;
  }

  res.render("admin/submissionNoteEdit", {
    note,
  });
}

/**
 * GET /admin/submissions/:submissionId/notes/:noteId/cancel
 * Cancel editing a note and return to read-only view
 */
export async function cancelEditSubmissionNote(req: MulmRequest, res: Response) {
  const noteId = parseInt(req.params.noteId);
  if (!noteId) {
    res.status(400).send("Invalid note ID");
    return;
  }

  const note = await getNoteById(noteId);
  if (!note) {
    res.status(404).send("Note not found");
    return;
  }

  res.render("admin/submissionNote", {
    note,
  });
}

/**
 * Whether this viewer may edit this Submission's details (#529): the table's
 * answer for `editApprovedDetails`, which is Approved only, committee only
 * and never the submitter.
 */
function mayEditDetails(viewer: NonNullable<MulmRequest["viewer"]>, submission: Submission): boolean {
  const isOwner = submission.member_id === viewer.id;
  return lifecycle.canMove(lifecycle.moves.editApprovedDetails, {
    state: lifecycle.deriveState(submission),
    changesPending: lifecycle.hasChangesRequested(submission),
    actor: isOwner ? "member" : "committee",
    actorId: viewer.id,
    isOwner,
    bound: submission.species_id != null,
  });
}

/**
 * GET /admin/submissions/:id/edit-approved
 * The Edit Approved Submission dialog: the member's details on an Approved
 * Submission, with a reason. The Species and points are not on it; it links
 * to the correction form for those (#529).
 */
export const editApprovedSubmissionForm = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  if (!submission.approved_on) {
    res.status(400).send("Only an Approved Submission's details are edited here");
    return;
  }
  if (!mayEditDetails(req.viewer!, submission)) {
    res.status(403).send("Cannot edit your own approved submissions");
    return;
  }

  const member = await getMember(submission.member_id);
  if (!member) {
    res.status(404).send("Member not found");
    return;
  }

  // Parse JSON arrays for display
  const parseStringArray = (jsonString: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        return parsed;
      }
    } catch {
      // JSON parse failed
    }
    return [];
  };

  res.render("admin/editApprovedSubmission", {
    submission: {
      ...submission,
      reproduction_date: submission.reproduction_date
        ? new Date(submission.reproduction_date).toISOString().split("T")[0]
        : "",
      foods: parseStringArray(submission.foods),
      spawn_locations: parseStringArray(submission.spawn_locations),
    },
    member,
    foodTypes,
    spawnLocations,
    // Conditional field visibility based on species type
    isLivestock: isLivestock(submission.species_type),
    hasFoods: hasFoods(submission.species_type),
    hasSpawnLocations: hasSpawnLocations(submission.species_type),
    hasLighting: hasLighting(submission.species_type),
    hasSupplements: hasSupplements(submission.species_type),
  });
};

/**
 * POST /admin/submissions/:id/edit-approved
 * Save the dialog: the member's details, with a reason, through
 * `editApprovedDetails`, which puts them on the changelog and tells nobody.
 * A refusal lands in the dialog's error banner.
 */
export const saveApprovedSubmissionEdits = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  if (!submission.approved_on) {
    res.status(400).send("Only an Approved Submission's details are edited here");
    return;
  }
  if (!mayEditDetails(viewer!, submission)) {
    res.status(403).send("Cannot edit your own approved submissions");
    return;
  }

  const parsed = editApprovedDetailsForm.safeParse(req.body);
  if (!parsed.success) {
    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });
    sendEditApprovedRefusal(res, [...errors.values()]);
    return;
  }

  const { reason, foods, spawn_locations, reproduction_date, ...rest } = parsed.data;
  const details: lifecycle.ApprovedDetails = { ...rest };

  // The form posts a day, the column holds an instant. The day the dialog
  // showed is the stored instant's UTC day: posted back unchanged, it is no
  // edit at all, so nothing is proposed and the changelog records nothing.
  // A changed day keeps the stored time of day.
  if (reproduction_date && submission.reproduction_date) {
    const oldDate = new Date(submission.reproduction_date);
    if (reproduction_date !== oldDate.toISOString().split("T")[0]) {
      const [year, month, day] = reproduction_date.split("-").map(Number);
      details.reproduction_date = new Date(
        Date.UTC(year, month - 1, day, oldDate.getUTCHours(), oldDate.getUTCMinutes(), oldDate.getUTCSeconds())
      ).toISOString();
    }
  } else if (reproduction_date) {
    details.reproduction_date = reproduction_date;
  }

  // The multi-selects are stored as JSON arrays
  if (foods !== undefined) {
    details.foods = JSON.stringify(foods);
  }
  if (spawn_locations !== undefined) {
    details.spawn_locations = JSON.stringify(spawn_locations);
  }

  try {
    const changes = await lifecycle.editApprovedDetails(callerFor(viewer!), submission.id, details, reason);
    logger.info(`Approved submission ${submission.id} details edited by admin ${viewer!.id}`, { changes });
  } catch (err) {
    if (lifecycle.isLifecycleError(err)) {
      logger.warn(`Lifecycle refusal: ${err.message}`, { submissionId: submission.id, adminId: viewer?.id, errorCode: err.code });
      sendEditApprovedRefusal(res, [err.message]);
      return;
    }
    logger.error("Error saving approved submission edits", err);
    res.status(500).send("Failed to save changes. Please try again.");
    return;
  }

  // Redirect back to submission page
  res.set("HX-Redirect", `/submissions/${submission.id}`).send();
};

/**
 * HTMX does not swap the body of a 4xx response, so a refusal is a 200 aimed
 * at the dialog's error banner, listing every message, so a rejected field
 * names itself to the committee member instead of failing silently.
 */
function sendEditApprovedRefusal(res: Response, messages: string[]): void {
  res.set("HX-Retarget", "#edit-approved-errors").set("HX-Reswap", "innerHTML");
  res.render("admin/editApprovedErrors", { messages });
}

/**
 * Show live display settings page (admin only)
 */
export const showLiveSettings = async (req: MulmRequest, res: Response) => {
  try {
    const message = (await getLiveCTAMessage()) || "";
    const renderedMessage = await marked(message);

    res.render("admin/liveSettings", {
      title: "Live Display Settings",
      message,
      renderedMessage,
    });
  } catch (error) {
    logger.error("Error loading live settings", error);
    res.status(500).send("Failed to load settings");
  }
};

/**
 * Update live CTA message
 */
export const updateLiveSettings = async (req: MulmRequest, res: Response) => {
  try {
    const message = getBodyString(req, "message") || "";

    await updateLiveCTAMessage(message);
    const renderedMessage = await marked(message);

    logger.info("Live CTA message updated");

    // Return rendered preview for HTMX swap
    res.send(renderedMessage);
  } catch (error) {
    logger.error("Error updating live settings", error);
    res.status(500).send("Failed to save settings");
  }
};

/**
 * Preview live CTA message (for live preview in admin)
 */
export const previewLiveCTA = async (req: MulmRequest, res: Response) => {
  try {
    const message = getBodyString(req, "message") || "";
    const renderedMessage = await marked(message);

    res.send(renderedMessage);
  } catch (error) {
    logger.error("Error previewing live CTA", error);
    res.status(500).send("Failed to render preview");
  }
};

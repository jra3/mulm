import { Response } from "express";
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
import { canonicalName as canonicalNameOf, findSpeciesById } from "@/species";
import * as lifecycle from "@/lifecycle";
import { attempt, callerFor } from "./lifecycleErrors";
import { getNotesForSubmission } from "@/db/submission_notes";
import { formatShortDate } from "@/utils/dateFormat";
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
  // Everyone can view, but owners and admins have extra controls
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  const { viewer } = req;

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

  // The Species the Submission is bound to, if any
  const boundSpecies = submission.species_id ? await findSpeciesById(submission.species_id) : undefined;

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
      final_submission_on: submission.final_submission_on
        ? formatShortDate(submission.final_submission_on)
        : null,
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

/** POST /submissions/:id/final-submit - brought to a meeting, now queue it. */
export const finalSubmit = async (req: MulmRequest, res: Response) => {
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
    lifecycle.enterApprovalQueue(callerFor(viewer), submission.id)
  );
  if (!done.ran) {
    return;
  }

  res.set("HX-Redirect", `/submissions/${submission.id}`).status(200).send();
};

/** DELETE /submissions/:id/final-submit - take it back out of the queue. */
export const unfinalSubmit = async (req: MulmRequest, res: Response) => {
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
    lifecycle.removeFromQueue(callerFor(viewer), submission.id)
  );
  if (!done.ran) {
    return;
  }

  res.set("HX-Redirect", `/submissions/${submission.id}`).status(200).send();
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

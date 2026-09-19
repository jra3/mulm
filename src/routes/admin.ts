import {
  createMember,
  getMember,
  getMemberByEmail,
  getRosterWithPoints,
  getMemberWithPoints,
  updateMember,
  getMemberPassword,
  getGoogleAccountByMemberId,
} from "@/db/members";
import {
  getQueue,
  getQueueCounts,
  getSubmissionById,
  getSubmissionsByMember,
  getSubmissionSupplements,
} from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { approvedEditSchema } from "@/forms/approvedEdit";
import { inviteSchema } from "@/forms/member";
import { sendInviteEmail } from "@/notifications";
import { getNextLevel, programMetadata, programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { createAuthCode } from "@/db/auth";
import { AuthCode, generateRandomCode } from "@/auth";
import { validateFormResult } from "@/forms/utils";
import { validateSubmission } from "./submission";
import {
  isLivestock,
  foodTypes,
  getClassOptions,
  spawnLocations,
  speciesTypes,
  waterTypes,
  hasLighting,
  hasSupplements,
  hasFoods,
  hasSpawnLocations,
} from "@/forms/submission";
import {
  ensureNameIdsForGroupId,
  isFirstTimeSpeciesForProgram,
  getSpeciesGroup,
  getGroupIdFromNameId,
} from "@/db/species";
import { getBodyParam, getBodyString, getQueryString } from "@/utils/request";
import { checkAllMemberLevels } from "@/levelManager";
import { checkAllSpecialtyAwards } from "@/specialtyAwardManager";
import { logger } from "@/utils/logger";
import { getStatusPresentation } from "@/utils/statusBadge";
import * as lifecycle from "@/lifecycle";
import { sendLifecycleError } from "./lifecycleErrors";
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

export const viewEditSubmission = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  const submissionMember = await getMember(submission.member_id);

  res.render("submit", {
    title: `Edit Submission`,
    subtitle: "Editing as admin",
    submissionId: submission.id,
    form: {
      ...submission,
      member_name: submissionMember?.display_name,
      member_email: submissionMember?.contact_email,
    },
    errors: new Map(),
    classOptions: getClassOptions(submission.species_type),
    waterTypes,
    speciesTypes,
    foodTypes,
    spawnLocations,
    isLivestock: isLivestock(submission.species_type),
    isAdmin: true,
    editing: true,
  });
  return;
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

export const showQueue = async (req: MulmRequest, res: Response) => {
  const { program = "fish" } = req.params;
  if (programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  const [submissions, programCounts, witnessCounts] = await Promise.all([
    getQueue("approval", program),
    getQueueCounts("approval"),
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

  res.render("admin/queue", {
    title: "Points Award Queue",
    subtitle,
    submissions: submissionsWithStatus,
    program,
    programCounts,
    witnessCounts,
  });
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

  // Everything that has been screened but is not yet in the approval queue:
  // the two states between the Witness and the queue. The approval queue
  // itself is a different page, and no Submission can appear on both.
  const [waiting, awaitingMeeting, programCounts, witnessCounts] = await Promise.all([
    getQueue("waitingPeriod", program),
    getQueue("awaitingFinalSubmission", program),
    getQueueCounts("approval"),
    getQueueCounts("witness"),
  ]);

  const submissionsWithStatus = [...waiting, ...awaitingMeeting].map((sub) => ({
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

export const confirmWitnessAction = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }

  try {
    await lifecycle.confirmWitness({ id: req.viewer!.id, isAdmin: true }, submission.id);
  } catch (err) {
    if (sendLifecycleError(res, err, { submissionId: submission.id, adminId: req.viewer?.id })) {
      return;
    }
    logger.error("Witness confirmation failed - unexpected error", err);
    res.status(500).send("An unexpected error occurred. Please try again.");
    return;
  }

  // Redirect to witness queue for the submission's program
  res.set("HX-Redirect", `/admin/witness-queue/${submission.program}`).send();
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

    // Check if member already has a password or Google account
    const password = await getMemberPassword(member.id);
    const googleAccount = await getGoogleAccountByMemberId(member.id);

    if (password || googleAccount) {
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
    });
  } catch (error) {
    logger.error("Error sending welcome email:", error);
    res.status(500).send("Failed to send welcome email. Please try again.");
  }
};

/**
 * GET /admin/submissions/:id/approval-bonuses
 * HTMX endpoint: Returns bonus checkboxes fragment when species is selected
 */
export const getApprovalBonuses = async (req: MulmRequest, res: Response) => {
  const { id } = req.params;
  const groupId = parseInt(getQueryString(req, "group_id", ""));

  if (isNaN(groupId)) {
    res.status(400).send("Invalid group ID");
    return;
  }

  const submission = await getSubmissionById(parseInt(id));
  if (!submission) {
    res.status(404).send("Submission not found");
    return;
  }

  try {
    // Check first-time status (program-wide) and get species data
    const [breedingHistory, speciesGroup] = await Promise.all([
      isFirstTimeSpeciesForProgram(groupId),
      getSpeciesGroup(groupId),
    ]);

    const templateData = {
      submission: {
        id: submission.id,
      },
      program: submission.program,
      isFirstTime: breedingHistory.isFirstTime,
      priorBreedCount: breedingHistory.priorBreedCount,
      isCaresSpecies: speciesGroup?.is_cares_species === 1,
      basePoints: speciesGroup?.base_points,
    };

    logger.info("Rendering approval bonuses", templateData);

    // Render the bonus checkboxes fragment (includes base points selector)
    res.render("admin/approvalBonuses", templateData);
  } catch (error) {
    logger.error("Error fetching approval bonuses", error);
    res.status(500).send("Error loading bonus data");
  }
};

export const approveSubmission = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;

  const id = getBodyParam(req, "id") as number;
  const submission = (await getSubmissionById(id))!;

  const errors = new Map<string, string>();
  const onError = () => {
    res.render("admin/approvalPanel", {
      submission: {
        id: submission.id,
        points: submission.points,
        species_class: submission.species_class,
        program: submission.program,
      },
      errors,
    });
  };

  const parsed = approvalSchema(submission.program).safeParse(req.body);
  if (!validateFormResult(parsed, errors, onError)) {
    return;
  }

  const updates = parsed.data;

  // Ensure species name IDs exist for the selected group_id
  const speciesIds = await ensureNameIdsForGroupId(
    updates.group_id,
    submission.species_common_name,
    submission.species_latin_name
  );

  // Approving is the only way Points are ever awarded. Everything that follows
  // from it - the member's email, the feed entry, the Level and Specialty
  // Award recompute - hangs off the transition, not off this handler.
  try {
    await lifecycle.approve({ id: viewer!.id, isAdmin: true }, id, speciesIds, updates);
  } catch (err) {
    if (sendLifecycleError(res, err, { submissionId: id, adminId: viewer?.id })) {
      return;
    }
    throw err;
  }

  // Redirect to approval queue for the submission's program
  res.set("HX-Redirect", `/admin/queue/${submission.program}`).send();
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
 * GET /admin/submissions/:id/edit-approved
 * Renders edit modal for approved submissions
 */
export const editApprovedSubmissionForm = async (req: MulmRequest, res: Response) => {
  const submission = await validateSubmission(req, res);
  if (!submission || !submission.approved_on) {
    res.status(400).send("Submission not found or not approved");
    return;
  }

  const { viewer } = req;

  // Prevent editing own submissions (prevents point manipulation)
  if (submission.member_id === viewer!.id) {
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

  // Get current group_id for species typeahead
  let currentGroupId = null;
  if (submission.common_name_id) {
    currentGroupId = await getGroupIdFromNameId(submission.common_name_id, true);
  } else if (submission.scientific_name_id) {
    currentGroupId = await getGroupIdFromNameId(submission.scientific_name_id, false);
  }

  // Fetch supplements from normalized table
  const supplements = await getSubmissionSupplements(submission.id);
  const supplement_type = supplements.map((s) => s.supplement_type).join(", ");
  const supplement_regimen = supplements.map((s) => s.supplement_regimen).join(", ");

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
    currentGroupId,
    foodTypes,
    spawnLocations,
    supplement_type,
    supplement_regimen,
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
 * Processes approved submission edits with full audit trail
 */
export const saveApprovedSubmissionEdits = async (req: MulmRequest, res: Response) => {
  logger.info("=== SAVE APPROVED EDITS CALLED ===", { submissionId: req.params.id });

  const { viewer } = req;
  const submission = await validateSubmission(req, res);

  if (!submission || !submission.approved_on) {
    logger.error("Submission not found or not approved", { submission });
    res.status(400).send("Submission not found or not approved");
    return;
  }

  // Prevent editing own submissions
  if (submission.member_id === viewer!.id) {
    res.status(403).send("Cannot edit your own approved submissions");
    return;
  }

  // Validate form
  const parsed = approvedEditSchema(submission.program).safeParse(req.body);
  if (!parsed.success) {
    logger.error("Validation failed", { errors: parsed.error.issues });
    const errors = new Map<string, string>();
    parsed.error.issues.forEach((issue) => {
      errors.set(String(issue.path[0]), issue.message);
    });

    // HTMX does not swap the body of a 4xx response, so a 400 here reached
    // nobody: the dialog sat there as if nothing had happened. Retarget the
    // dialog's error banner and list every message, so a rejected bonus names
    // itself to the committee member instead of failing silently.
    res.set("HX-Retarget", "#edit-approved-errors").set("HX-Reswap", "innerHTML");
    res.render("admin/editApprovedErrors", { messages: [...errors.values()] });
    return;
  }

  logger.info("Validation passed", { data: parsed.data });

  const updates = parsed.data;
  const reason = updates.reason;

  // Remove reason and group_id from updates (reason goes in audit log, group_id is converted to name IDs)
  delete (updates as Partial<typeof updates>).reason;
  const groupId = updates.group_id;
  delete (updates as Partial<typeof updates>).group_id;

  // Preserve time component of reproduction_date if date changed
  if (updates.reproduction_date && submission.reproduction_date) {
    const oldDate = new Date(submission.reproduction_date);
    const newDateOnly = updates.reproduction_date; // YYYY-MM-DD format from form

    // Extract time component from old date
    const hours = oldDate.getUTCHours();
    const minutes = oldDate.getUTCMinutes();
    const seconds = oldDate.getUTCSeconds();

    // Combine new date with old time
    const [year, month, day] = newDateOnly.split("-").map(Number);
    const newDateTime = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

    // Use ISO string for database storage
    updates.reproduction_date = newDateTime.toISOString();
  }

  // Convert arrays from multi-select to JSON strings for database storage
  const updatesForDb = { ...updates } as Record<string, unknown>;
  if (updates.foods !== undefined) {
    updatesForDb.foods = JSON.stringify(updates.foods || []);
  }
  if (updates.spawn_locations !== undefined) {
    updatesForDb.spawn_locations = JSON.stringify(updates.spawn_locations || []);
  }

  // If species group changed, update name IDs
  if (groupId && groupId !== submission.common_name_id) {
    const speciesIds = await ensureNameIdsForGroupId(
      groupId,
      submission.species_common_name,
      submission.species_latin_name
    );
    updatesForDb.common_name_id = speciesIds.common_name_id;
    updatesForDb.scientific_name_id = speciesIds.scientific_name_id;
  }

  try {
    // Correcting an Approved Submission is the only movement out of Approved.
    // The changelog, the feed entry updated in place rather than appended, and
    // the symmetric Level and Specialty Award recompute all hang off the move.
    const changes = await lifecycle.correctPoints(
      { id: viewer!.id, isAdmin: true },
      submission.id,
      updatesForDb,
      reason
    );
    logger.info(`Approved submission ${submission.id} corrected by admin ${viewer!.id}`, {
      changes,
    });
  } catch (err) {
    if (sendLifecycleError(res, err, { submissionId: submission.id, adminId: viewer?.id })) {
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

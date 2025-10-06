import { Response } from 'express';
import { getBapFormTitle, getClassOptions, waterTypes, speciesTypes, foodTypes, spawnLocations, bapDraftForm, bapFields, bapForm, FormValues, hasFoods, hasSpawnLocations, hasLighting, hasSupplements, isLivestock } from "@/forms/submission";
import { extractValid } from "@/forms/utils";
import { getQueryString } from "@/utils/request";
import { MulmRequest } from "@/sessions";
import { MemberRecord, getMember, getMemberByEmail } from "@/db/members";
import { onSubmissionSend } from "@/notifications";
import * as db from "@/db/submissions";
import { getCanonicalSpeciesName } from "@/db/species";
import { getWaitingPeriodStatus } from "@/utils/waitingPeriod";

export const renderSubmissionForm = (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const form = {
    // auto-fill member name and email if logged in
    member_name: viewer?.display_name,
    member_email: viewer?.contact_email,
    ...req.query,
  };

  const selectedType = getQueryString(req, 'species_type', 'Fish');
  res.render("submit", {
    title: getBapFormTitle(selectedType),
    form,
    errors: new Map(),
    classOptions: getClassOptions(selectedType),
    waterTypes,
    speciesTypes,
    foodTypes,
    spawnLocations,
    isLivestock: isLivestock(selectedType),
    hasFoods: hasFoods(selectedType),
    hasSpawnLocations: hasSpawnLocations(selectedType),
    hasLighting: hasLighting(selectedType),
    hasSupplements: hasSupplements(selectedType),
    isAdmin: Boolean(viewer?.is_admin),
  });
};

export const view = async (req: MulmRequest, res: Response) => {
  // Everyone can view, but owners and admins have extra controls
  const submission = await validateSubmission(req, res);
  if (!submission) {
    return;
  }
  const { viewer } = req;

  const local = (time?: string | null) => {
    if (!time) {
      return undefined;
    }
    const date = new Date(time);
    return date.toLocaleDateString();
  }

  const parseStringArray = (jsonString: string): string[] => {
    try {
      const parsed: unknown = JSON.parse(jsonString);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed;
      }
    } catch {
      // JSON parse failed, return empty array
    }
    return [];
  }

  let approver: MemberRecord | undefined;
  if (submission.approved_by != null) {
    approver = await getMember(submission.approved_by);
  }

  let witness: MemberRecord | undefined;
  if (submission.witnessed_by != null) {
    witness = await getMember(submission.witnessed_by);
  }

  const aspect = {
    isSubmitted: submission.submitted_on != null,
    isApproved: submission.approved_on != null,
    isLoggedIn: Boolean(viewer),
    isSelf: viewer && submission.member_id === viewer.id,
    isAdmin: viewer && viewer.is_admin,
  };

  if (viewer && aspect.isSelf && !aspect.isSubmitted) {
    res.render('submit', {
      title: `Edit ${getBapFormTitle(submission.program)}`,
      form: {
        ...submission,
        member_name: viewer.display_name,
        member_email: viewer.contact_email,
        foods: parseStringArray(submission.foods),
        spawn_locations: parseStringArray(submission.spawn_locations),
        supplement_type: parseStringArray(submission.supplement_type),
        supplement_regimen: parseStringArray(submission.supplement_regimen),
      },
      errors: new Map(),
      classOptions: getClassOptions(submission.species_type),
      waterTypes,
      speciesTypes,
      foodTypes,
      spawnLocations,
      isLivestock: isLivestock(submission.species_type),
      hasFoods: hasFoods(submission.species_type),
      hasSpawnLocations: hasSpawnLocations(submission.species_type),
      hasLighting: hasLighting(submission.species_type),
      hasSupplements: hasSupplements(submission.species_type),
      isAdmin: aspect.isAdmin,
    });
    return;
  }

  const nameGroup = await (async () => {
    if (submission.species_name_id) {
      const name = await getCanonicalSpeciesName(submission.species_name_id);
      if (name) {
        return name;
      }
    }
    const [genus, ...parts] = submission.species_latin_name.split(" ");
    return {
      canonical_genus: genus,
      canonical_species_name: parts.join(" "),
    };
  })();

  const canonicalName = `${nameGroup.canonical_genus} ${nameGroup.canonical_species_name}`;

  // Calculate waiting period eligibility
  const waitingPeriodStatus = getWaitingPeriodStatus(submission);

  res.render('submission/review', {
    submission: {
      ...submission,
      reproduction_date: local(submission.reproduction_date),
      submitted_on: local(submission.submitted_on),
      witnessed_on: local(submission.witnessed_on),
      approved_on: local(submission.approved_on),
      approved_by: approver?.display_name,
      witnessed: witness && submission.witnessed_on ? `${witness.display_name} - ${local(submission.witnessed_on)}` : undefined,
      approved: approver && submission.approved_on ? `${approver.display_name} - ${local(submission.approved_on)}` : undefined,

      foods: parseStringArray(submission.foods).join(","),
      spawn_locations: parseStringArray(submission.spawn_locations).join(","),
    },
    canonicalName,
    name: nameGroup,
    waitingPeriodStatus,
    ...aspect,
  });
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
	form: FormValues,
	draft: boolean,
	errors?: Map<string, string>,
} {
  let draft = false;
  let form: FormValues;
  let parsed;

  if ("draft" in req.body) {
    parsed = bapDraftForm.safeParse(req.body);
    form = extractValid(bapFields, req.body);
    draft = true;
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
    const selectedType = form.species_type || 'Fish';
    res.render('bapForm/form', {
      title: getBapFormTitle(selectedType),
      form,
      errors,
      classOptions: getClassOptions(selectedType),
      waterTypes,
      speciesTypes,
      foodTypes,
      spawnLocations,
      isLivestock: isLivestock(selectedType),
      hasFoods: hasFoods(selectedType),
      hasSpawnLocations: hasSpawnLocations(selectedType),
      hasLighting: hasLighting(selectedType),
      hasSupplements: hasSupplements(selectedType),
      isAdmin: Boolean(viewer.is_admin),
    });
    return;
  }

  if (form.member_email != viewer.contact_email || form.member_name != viewer.display_name) {
    // Admins can supply any member
    if (!viewer.is_admin) {
      res.status(403).send();
      return;
    }
  }

  const member = await getMemberByEmail(form.member_email!);

  if (!member) {
    res.status(400).send("No member found");
    return;
  }

  const memberId = member.id;


  // TODO figure out how to avoid read after write
  const subId = await db.createSubmission(memberId, form, !draft);
  const sub = await db.getSubmissionById(subId);

  if (!sub) {
    res.status(500).send("Failed to create submission");
    return;
  }

  if (!draft) {
    await onSubmissionSend(sub, member);
  }

  res.render('submission/success', {
    title: "Submission Complete",
    member,
    subId,
  });
}

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

  if (!viewer.is_admin) {
    if (viewer.id !== submission.member_id) {
      res.status(403).send("Submission already submitted");
      return;
    }
  }

  if (viewer?.id !== submission?.member_id && !viewer.is_admin) {
    res.status(403).send();
    return;
  }

  if ("unsubmit" in req.body) {
    await db.updateSubmission(submission.id, { submitted_on: null });
    res.set('HX-Redirect', '/sub/' + submission.id).send();
    return;
  }

  const { form, draft, errors } = parseAndValidateForm(req);
  if (errors) {
    const selectedType = form.species_type || 'Fish';
    res.render('bapForm/form', {
      title: `Edit ${getBapFormTitle(selectedType)}`,
      form,
      errors,
      classOptions: getClassOptions(selectedType),
      waterTypes,
      speciesTypes,
      foodTypes,
      spawnLocations,
      isLivestock: isLivestock(selectedType),
      hasFoods: hasFoods(selectedType),
      hasSpawnLocations: hasSpawnLocations(selectedType),
      hasLighting: hasLighting(selectedType),
      hasSupplements: hasSupplements(selectedType),
      isAdmin: Boolean(viewer.is_admin),
    });
    return;
  }

  // TODO fix silly serial queries at some point
  await db.updateSubmission(submission.id, db.formToDB(submission.member_id, form, !draft));
  const sub = await db.getSubmissionById(submission.id);
  const member = await getMember(submission.member_id);
  if (!draft && sub && member) {
    await onSubmissionSend(sub, member);
  }

  res.render('submission/success', {
    title: "Edits Saved",
    member,
    subId: submission.id,
  });
}

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

  // Admin always delete
  if (!viewer.is_admin) {
    // Owner can delete when not submitted
    if (viewer.id !== submission.member_id && submission.submitted_on != null) {
      res.status(403).send();
      return;
    }
  }

  await db.deleteSubmission(submission.id);
}

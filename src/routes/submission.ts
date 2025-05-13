import { Response } from 'express';
import { getBapFormTitle, getClassOptions, waterTypes, speciesTypes, foodTypes, spawnLocations, bapDraftForm, bapFields, bapForm, FormValues } from "@/forms/submission";
import { extractValid, isLivestock } from "@/forms/utils";
import { MulmRequest } from "@/sessions";
import { MemberRecord, getMember, getMemberByEmail } from "@/db/members";
import { onSubmissionSend } from "@/notifications";
import * as db from "@/db/submissions";

export const renderSubmissionForm = (req: MulmRequest, res: Response) => {
const { viewer } = req;
	const form = {
		// auto-fill member name and email if logged in
		member_name: viewer?.display_name,
		member_email: viewer?.contact_email,
		...req.query,
	};

	const selectedType = String(req.query.species_type ?? "Fish");
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

	let approver: MemberRecord | undefined;
	if (submission.approved_by != null) {
		approver = await getMember(submission.approved_by);
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
			},
			errors: new Map(),
			classOptions: getClassOptions(submission.species_type),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(submission.species_type),
			isAdmin: aspect.isAdmin,
		});
		return;
	}

	res.render('submission/review', {
		submission: {
			...submission,
			reproduction_date: local(submission.reproduction_date),
			submitted_on: local(submission.submitted_on),
			approved_on: local(submission.approved_on),
			approved_by: approver?.display_name,

			foods: JSON.parse(submission.foods)?.join(","),
			spawn_locations: JSON.parse(submission.spawn_locations)?.join(","),
		},
		...aspect,
	});
}

export function validateSubmission(req: MulmRequest, res: Response) {
	const subId = parseInt(req.params.subId);
	if (!subId) {
		res.status(400).send("Invalid submission id");
		return;
	}

	const submission = db.getSubmissionById(subId);
	if (!submission) {
		res.status(404).send("Submission not found");
		return;
	}

	return submission;
}

async function parseAndValidateForm(req: MulmRequest): Promise<{
	form?: never;
	draft?: never;
	errors: Map<string, string>,
} | {
	form: FormValues,
	draft: boolean
	errors?: never;
}> {
	let draft = false;
	let form: FormValues;
	let parsed;

	if ("draft" in req.body) {
		parsed = bapDraftForm.safeParse(req.body);
		form = extractValid(bapFields, req.body);
		draft = true;
	} else {
		parsed = bapForm.safeParse(req.body);
		form = parsed.data!;
	}

	if (!parsed.success) {
		const errors = new Map<string, string>();
		parsed.error.issues.forEach((issue) => {
			errors.set(String(issue.path[0]), issue.message);
		});

		return { errors };
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

	const { errors, form, draft} = await parseAndValidateForm(req);

	if (errors) {
		const selectedType = req.body.species_type;
		res.render('bapForm/form', {
			title: getBapFormTitle(selectedType),
			form: req.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
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
	let memberId: number;

	if (!member) {

		/*

		TODO implement me after better-auth

		if (viewer.is_admin) {
			// create a placeholder member
			memberId = createMember(form.contact_email!, form.member_name!);
			member = getMember(memberId)!;
		} else {
			res.status(403).send("User cannot submit for this member");
			return;
		}

		*/

	} else {
		memberId = member.id;
	}

	// TODO figure out how to avoid read after write
	const subId = await db.createSubmission(memberId!, form, !draft);
	const sub = await db.getSubmissionById(subId);

	if (!sub) {
		res.status(500).send("Failed to create submission");
		return;
	}

	if (!draft) {
		onSubmissionSend(sub, member!);
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
		db.updateSubmission(submission.id, { submitted_on: null });
		res.set('HX-Redirect', '/sub/' + submission.id).send();
		return;
	}

	const { form, draft, errors } = await parseAndValidateForm(req);
	if (errors) {
		const selectedType = String(req.body.species_type);
		res.render('bapForm/form', {
			title: `Edit ${getBapFormTitle(selectedType)}`,
			form: req.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
		return;
	}

	// TODO fix silly serial queries at some point
	db.updateSubmission(submission.id, db.formToDB(submission.member_id, form, !draft));
	const sub = await db.getSubmissionById(submission.id);
	const member = await getMember(submission.member_id);
	if (!draft && sub && member) {
		onSubmissionSend(sub, member);
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

	db.deleteSubmission(submission.id);
}

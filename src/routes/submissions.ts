import * as db from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { getMember, getMemberByEmail, MemberRecord } from "@/db/members";
import { onSubmissionApprove, onSubmissionSend } from "@/notifications";
import { bapDraftForm, bapFields, bapForm, foodTypes, FormValues, getBapFormTitle, getClassOptions, isLivestock, spawnLocations, speciesTypes, waterTypes } from "../forms/submission";
import { extractValid } from "@/forms/utils";
import { MulmRequest } from "@/sessions";
import { Response } from 'express';

function validateSubmission(req: MulmRequest, res: Response) {

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

export async function viewSubmission(req: MulmRequest, res: Response) {
	// Everyone can view, but owners and admins have extra controls
	const submission = validateSubmission(req, res);
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
		approver = getMember(submission.approved_by);
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

export async function createSubmission(req: MulmRequest, res: Response) {
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

	const member = getMemberByEmail(form.member_email!);
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

	const subId = db.createSubmission(memberId!, form, !draft);
	const sub = db.getSubmissionById(subId);

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

export async function updateSubmission(req: MulmRequest, res: Response) {
	const { viewer } = req;
	const submission = validateSubmission(req, res);
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
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const selectedType = (req.body as any).species_type;
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
	const sub = db.getSubmissionById(submission.id);
	const member = getMember(submission.member_id);
	if (!draft && sub && member) {
		onSubmissionSend(sub, member);
	}

	res.render('submission/success', {
		title: "Edits Saved",
		member,
		subId: submission.id,
	});
}

export async function deleteSubmission(req: MulmRequest, res: Response) {
	const submission = validateSubmission(req, res);
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

export async function adminApproveSubmission(req: MulmRequest, res: Response) {
	const { viewer } = req;
	if (!viewer) {
		res.status(401).send();
		return;
	}

	if (!viewer.is_admin) {
		res.status(403).send();
		return;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = req.body as any;
	if ("reject" in body) {
		console.log("rejected!");
		return;
	}

	if ("delete" in body) {
		console.log("delete!");
		return;
	}

	const parsed = approvalSchema.safeParse(req.body);
	if (!parsed.success) {
		console.error(parsed.error.issues);
		res.status(400).send("Invalid input");
		return;
	}

	const updates = parsed.data;
	const { id, points } = updates;

	if (!points) {
		res.status(400).send("Invalid input");
		return;
	}

	db.approveSubmission(viewer.id, id, updates);

	const submission = db.getSubmissionById(id)!;
	const member = getMember(submission.member_id)!;
	if (member) {
		// member should always exist...
		onSubmissionApprove(submission, member);
	}
	res.set('HX-Redirect', '/admin/queue').send();
}


import * as db from "../db/submissions";
import { MulmContext } from "../sessions";
import { approvalSchema } from "../forms/approval";
import { createMember, getMember, getMemberByEmail, MemberRecord } from "../db/members";
import { onSubmissionApprove, onSubmissionSend } from "../notifications";
import { bapDraftForm, bapFields, bapForm, foodTypes, FormValues, getBapFormTitle, getClassOptions, isLivestock, spawnLocations, speciesTypes, waterTypes } from "../forms/submission";
import { extractValid } from "../forms/utils";

function validateSubmission(ctx: MulmContext) {
	const subId = parseInt(ctx.params.subId);
	if (!subId) {
		ctx.status = 400;
		ctx.body = "Invalid submission id";
		return;
	}

	const submission = db.getSubmissionById(subId);
	if (!submission) {
		ctx.status = 404;
		ctx.body = "Submission not found";
		return;
	}

	return submission;
}

export async function viewSubmission(ctx: MulmContext) {
	// Everyone can view, but owners and admins have extra controls
	const submission = validateSubmission(ctx);
	if (!submission) {
		return;
	}
	const viewer = ctx.loggedInUser;

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
		isSelf: viewer && submission.member_id === viewer.member_id,
		isAdmin: viewer && viewer.is_admin,
	};

	if (viewer && aspect.isSelf && !aspect.isSubmitted) {
		await ctx.render('submit', {
			title: `Edit ${getBapFormTitle(submission.program)}`,
			form: {
				...submission,
				member_name: viewer.member_name,
				member_email: viewer.member_email,
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

	await ctx.render('submission/review', {
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

async function parseAndValidateForm(ctx: MulmContext) {

	let draft = false;
	let form: FormValues;
	let parsed;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if ("draft" in (ctx.request.body as any)) {
		parsed = bapDraftForm.safeParse(ctx.request.body);
		form = extractValid(bapFields, ctx.request.body);
		draft = true;
	} else {
		parsed = bapForm.safeParse(ctx.request.body);
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

export async function createSubmission(ctx: MulmContext) {
	const viewer = ctx.loggedInUser;
	if (!viewer) {
		ctx.status = 403;
		ctx.body = "You must be logged in to submit";
		return;
	}

	const { form, draft, errors } = await parseAndValidateForm(ctx);

	if (errors) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const selectedType = (ctx.request.body as any).species_type;
		return ctx.render('bapForm/form', {
			title: getBapFormTitle(selectedType),
			form: ctx.request.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
	}

	if (form.member_email != viewer.member_email || form.member_name != viewer.member_name) {
		// Admins can supply any member
		if (!viewer.is_admin) {
			ctx.status = 403;
			ctx.body = "User cannot submit for this member";
			return;
		}
	}

	let member = getMemberByEmail(form.member_email!);
	let memberId: number;

	if (!member) {
		if (viewer.is_admin) {
			// create a placeholder member
			memberId = createMember(form.member_email!, form.member_name!);
			member = getMember(memberId)!;
		} else {
			ctx.status = 403;
			ctx.body = "User cannot submit for this member";
			return;
		}
	} else {
		memberId = member.id;
	}

	const subId = db.createSubmission(memberId, form, !draft);
	const sub = db.getSubmissionById(subId);

	if (!sub) {
		ctx.status = 500;
		ctx.body = "Failed to create submission";
		return;
	}

	if (!draft) {
		onSubmissionSend(sub, member);
	}

	await ctx.render('submission/success', {
		title: "Submission Complete",
		member,
		subId,
	});
}

export async function updateSubmission(ctx: MulmContext) {
	const submission = validateSubmission(ctx);
	if (!submission) {
		return;
	}
	const viewer = ctx.loggedInUser;

	// Admin can always update
	// User can update if not submitted

	if (!viewer || viewer?.member_id !== submission?.member_id && !viewer.is_admin) {
		ctx.status = 403;
		ctx.body = "Forbidden";
		return;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if ("unsubmit" in (ctx.request.body as any)) {
		db.updateSubmission(submission.id, { submitted_on: null });
		ctx.set('HX-Redirect', '/sub/' + submission.id);
		return;
	}

	const { form, draft, errors } = await parseAndValidateForm(ctx);
	if (errors) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const selectedType = (ctx.request.body as any).species_type;
		return ctx.render('bapForm/form', {
			title: `Edit ${getBapFormTitle(selectedType)}`,
			form: ctx.request.body,
			errors,
			classOptions: getClassOptions(selectedType),
			waterTypes,
			speciesTypes,
			foodTypes,
			spawnLocations,
			isLivestock: isLivestock(selectedType),
			isAdmin: Boolean(viewer.is_admin),
		});
	}

	// TODO fix silly serial queries at some point
	db.updateSubmission(submission.id, db.formToDB(submission.member_id, form, !draft));
	const sub = db.getSubmissionById(submission.id);
	const member = getMember(submission.member_id);
	if (!draft && sub && member) {
		onSubmissionSend(sub, member);
	}

	await ctx.render('submission/success', {
		title: "Edits Saved",
		member,
		subId: submission.id,
	});
}

export async function deleteSubmission(ctx: MulmContext) {
	const submission = validateSubmission(ctx);
	if (!submission) {
		return;
	}
	const viewer = ctx.loggedInUser;

	// Admin can always delete
	// User can delete if not submitted
	if (!viewer || !(viewer.is_admin || (viewer.member_id === submission?.member_id))) {
		ctx.status = 403;
		ctx.body = "Forbidden";
		return;
	}

	db.deleteSubmission(submission.id);
}

export async function adminApproveSubmission(ctx: MulmContext) {
	const viewer = ctx.loggedInUser;
	if (!viewer || !viewer.is_admin) {
		ctx.status = 403;
		ctx.body = "Forbidden";
		return;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = ctx.request.body as any;
	if ("reject" in body) {
		console.log("rejected!");
		return;
	}

	if ("delete" in body) {
		console.log("delete!");
		return;
	}

	const parsed = approvalSchema.safeParse(ctx.request.body);
	if (!parsed.success) {
		ctx.status = 400;
		ctx.body = "Invalid input";
		console.error(parsed.error.issues);
		return;
	}

	const updates = parsed.data;
	const { id, points } = updates;

	if (!points) {
		ctx.status = 400;
		ctx.body = "Invalid input";
		return;
	}

	db.approveSubmission(viewer.member_id, id, updates);

	const submission = db.getSubmissionById(id)!;
	const member = getMember(submission.member_id)!;
	if (member) {
		// member should always exist...
		onSubmissionApprove(submission, member);
	}
	ctx.set('HX-Redirect', '/admin/queue');
}

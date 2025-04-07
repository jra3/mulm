import * as db from "../db/submissions";
import { MulmContext } from "../sessions";
import { approvalSchema } from "../forms/approval";

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
	await ctx.render('submission/review', {
		submission,
		isSelf: viewer && submission.member_id === viewer.member_id,
		isAdmin: viewer && viewer.is_admin,
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
	if (!viewer || !(viewer.is_admin || (viewer.member_id === submission?.member_id))) {
		ctx.status = 403;
		ctx.body = "Forbidden";
		return;
	}

	console.log("Implement patch");
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

	const { id, points } = parsed.data;
	if (!points) {
		ctx.status = 400;
		ctx.body = "Invalid input";
		return;
	}

	db.approveSubmission(id, points, viewer.member_id);

	ctx.set('HX-Redirect', '/admin/queue');
}

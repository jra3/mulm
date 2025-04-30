import * as db from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { getMember } from "@/db/members";
import { onSubmissionApprove } from "@/notifications";
import { MulmRequest } from "@/sessions";
import { Response } from 'express';

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


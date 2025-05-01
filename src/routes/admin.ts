import { getMember, getRoster, updateMember } from "@/db/members";
import { getOutstandingSubmissions, getOutstandingSubmissionsCounts, getSubmissionById } from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { memberSchema } from "@/forms/member";
import { onSubmissionApprove } from "@/notifications";
import { levelRules, programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { approveSubmission as approve } from "@/db/submissions";

export async function requireAdmin(
	req: MulmRequest,
	res: Response,
	next: NextFunction) {

	if (!req.viewer) {
		res.status(401).send();
	} if (!req.viewer?.is_admin) {
		res.status(403).send();
	} else {
		next();
	}
}

export const viewMembers = async (req: MulmRequest, res: Response) => {
	const members = getRoster();
	res.render("admin/members", {
		title: "Member Roster",
		members,
	});
}

export const viewMemberUpdate = async (req: MulmRequest, res: Response) => {
	const fishLevels = levelRules.fish.map((level) => level[0]);
	const plantLevels = levelRules.plant.map((level) => level[0]);
	const coralLevels = levelRules.coral.map((level) => level[0]);

	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}
	const member = getMember(id);

	// Render one table row for editing
	res.render("admin/editMember", {
		member,
		fishLevels,
		plantLevels,
		coralLevels,
	});

}

export const updateMemberFields = async (req: MulmRequest, res: Response) => {
	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}

	// TODO do i have to use some better-auth call instead?
	const parsed = memberSchema.parse(req.body);
	updateMember(id, {
		...parsed,
		is_admin: parsed.is_admin !== undefined ? 1 : 0,
	});
	// TODO can we get the result after the update instead of querying?
	const member = getMember(id);

	res.render("admin/singleMemberRow", { member });
}

export const showQueue = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;
	if (!viewer?.is_admin) {
		res.status(403).send("Access denied");
		return;
	}
	const { program = "fish" } = req.params;
	if (programs.indexOf(program) === -1) {
		res.status(404).send("Invalid program");
		return;
	}

	const submissions = getOutstandingSubmissions(program);
	const programCounts = getOutstandingSubmissionsCounts();

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
		title: "Approval Queue",
		subtitle,
		submissions,
		program,
		programCounts,
	});
}

export const approveSubmission = async (req: MulmRequest, res: Response) => {
	const { viewer } = req;

	/*

	const body = req.body;

	if ("reject" in body) {
		console.log("rejected!");
		return;
	}

	if ("delete" in body) {
		console.log("delete!");
		return;
	}

	*/

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

	approve(viewer!.id, id, updates);

	const submission = (await getSubmissionById(id))!;
	const member = await getMember(submission.member_id)!;
	if (member) {
		// member should always exist...
		onSubmissionApprove(submission, member);
	}

	res.set('HX-Redirect', '/admin/queue').send();
}

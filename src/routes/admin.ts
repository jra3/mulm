import { createMember, getMember, getMemberByEmail, getRoster, updateMember } from "@/db/members";
import { getOutstandingSubmissions, getOutstandingSubmissionsCounts, getSubmissionById } from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { inviteSchema, memberSchema } from "@/forms/member";
import { onSubmissionApprove, sendInviteEmail } from "@/notifications";
import { levelRules, programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { approveSubmission as approve } from "@/db/submissions";
import { createAuthCode } from "@/db/auth";
import { AuthCode, generateRandomCode } from "@/auth";
import { isLivestock, validateFormResult } from "@/forms/utils";
import { validateSubmission } from "./submission";
import { foodTypes, getClassOptions, spawnLocations, speciesTypes, waterTypes } from "@/forms/submission";

export function requireAdmin(
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
	const members = await getRoster();
	res.render("admin/members", {
		title: "Member Roster",
		members,
	});
}

export const viewEditSubmission = async (req: MulmRequest, res: Response) => {
	const submission = await validateSubmission(req, res);
	if (!submission) {
		return;
	}
	const submissionMember = await getMember(submission.member_id);

	res.render('submit', {
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
	const member = await getMember(id);

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
	await updateMember(id, {
		...parsed,
		is_admin: parsed.is_admin !== undefined ? 1 : 0,
	});
	// TODO can we get the result after the update instead of querying?
	const member = getMember(id);

	res.render("admin/singleMemberRow", { member });
}

export const showQueue = async (req: MulmRequest, res: Response) => {
	const { program = "fish" } = req.params;
	if (programs.indexOf(program) === -1) {
		res.status(404).send("Invalid program");
		return;
	}

	const [submissions, programCounts] = await Promise.all([
		getOutstandingSubmissions(program),
		getOutstandingSubmissionsCounts(),
	]);

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

export const inviteMember = async (req: MulmRequest, res: Response) => {
	const errors = new Map<string, string>();
	const renderDialog = () => {
		res.render("admin/inviteUser", {
			...req.body,
			errors,
		});
	}

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

	await approve(viewer!.id, id, updates);

	const submission = (await getSubmissionById(id))!;
	const member = await getMember(submission.member_id);
	if (member) {
		// member should always exist...
		await onSubmissionApprove(submission, member);
	}

	res.set('HX-Redirect', '/admin/queue').send();
}



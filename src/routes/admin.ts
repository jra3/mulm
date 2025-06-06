import { createMember, getMember, getMemberByEmail, getRoster, updateMember } from "@/db/members";
import { getOutstandingSubmissions, getOutstandingSubmissionsCounts, getSubmissionById, updateSubmission } from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { inviteSchema, memberSchema } from "@/forms/member";
import { onSubmissionApprove, sendChangesRequest, sendInviteEmail } from "@/notifications";
import { levelRules, programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { approveSubmission as approve } from "@/db/submissions";
import { createAuthCode } from "@/db/auth";
import { AuthCode, generateRandomCode } from "@/auth";
import { isLivestock, validateFormResult } from "@/forms/utils";
import { validateSubmission } from "./submission";
import { foodTypes, getClassOptions, spawnLocations, speciesTypes, waterTypes } from "@/forms/submission";
import { recordName } from "@/db/species";

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

export const sendRequestChanges = async (req: MulmRequest, res: Response) => {
	const submission = await validateSubmission(req, res);
	if (!submission) {
		res.send("Submission not found");
		return;
	}

	const member = await getMember(submission.member_id);
	if (!member) {
		res.send("Member not found");
		return;
	}

	await Promise.all([
		updateSubmission(submission.id, { submitted_on: null }),
		sendChangesRequest(
			submission,
			member?.contact_email,
			String(req.body.content)),
	]);

	res.set('HX-Redirect', `/sub/${submission.id}`).send();
}

export const requestChangesForm = async (req: MulmRequest, res: Response) => {
	const submission = await validateSubmission(req, res);
	if (!submission) {
		res.send("Error: submission not found");
		return;
	}

	const contents = `
Changes are requested form your BAP submission. Please review the notes below, make appropriate changes, and resubmit.

-----------------

Water Type: ${submission.water_type}
Species Class: ${submission.species_class}
Common Name: ${submission.species_common_name}
Latin Name: ${submission.species_latin_name}

Date: ${submission.reproduction_date}
Spawn Locations: ${JSON.parse(submission.spawn_locations).join(", ")}
Foods: ${JSON.parse(submission.foods).join(", ")}

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
`
	res.render("admin/requestChanges", {
		submission,
		contents,
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

	const errors = new Map<string, string>();
	const onError = async () => {
		const submission = (await getSubmissionById(req.body.id))!;
		res.render("admin/approvalPanel", {
			submission: {
				id: submission.id,
				points: submission.points,
				species_class: submission.species_class,
			},
			errors,
			name: {
				canonical_genus: req.body.canonical_genus,
				canonical_species_name: req.body.canonical_species_name
			},
		});
	};

	const parsed = approvalSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, onError)) {
		return;
	}

	const updates = parsed.data;
	const { id } = updates;
	const submission = (await getSubmissionById(id))!;

	const speciesGroupId = await recordName({
		program_class: submission.species_class,
		common_name: submission.species_common_name,
		latin_name: submission.species_latin_name,
		canonical_genus: parsed.data.canonical_genus,
		canonical_species_name: parsed.data.canonical_species_name,
	});

	await approve(viewer!.id, id, speciesGroupId, updates);
	const member = await getMember(submission.member_id);
	if (member) {
		// member should always exist...
		await onSubmissionApprove(submission, member);
	}

	res.set('HX-Redirect', '/admin/queue').send();
}



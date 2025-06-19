import { createMember, getMember, getMemberByEmail, getRosterWithPoints, updateMember, type MemberRecord } from "@/db/members";
import { getOutstandingSubmissions, getOutstandingSubmissionsCounts, getSubmissionById, updateSubmission, getSubmissionsByMember, type Submission } from "@/db/submissions";
import { approvalSchema } from "@/forms/approval";
import { inviteSchema } from "@/forms/member";
import { onSubmissionApprove, sendChangesRequest, sendInviteEmail } from "@/notifications";
import { programs } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";
import { approveSubmission as approve } from "@/db/submissions";
import { createAuthCode } from "@/db/auth";
import { AuthCode, generateRandomCode } from "@/auth";
import { validateFormResult } from "@/forms/utils";
import { validateSubmission } from "./submission";
import { isLivestock, foodTypes, getClassOptions, spawnLocations, speciesTypes, waterTypes } from "@/forms/submission";
import { recordName } from "@/db/species";
import { getBodyParam, getBodyString } from "@/utils/request";
import { checkAndUpdateMemberLevel, checkAllMemberLevels, Program } from "@/levelManager";
import { checkAndGrantSpecialtyAwards, checkAllSpecialtyAwards } from "@/specialtyAwardManager";

// Helper function to calculate total points for a member
async function getMemberWithPoints(member: MemberRecord | null): Promise<MemberRecord & { fishTotalPoints: number; plantTotalPoints: number; coralTotalPoints: number } | null> {
	if (!member) return null;
	
	const submissions: Submission[] = await getSubmissionsByMember(
		member.id.toString(),
		false, // don't include unsubmitted
		false  // don't include unapproved
	);
	
	const fishSubmissions = submissions.filter((sub: Submission) => 
		sub.species_type === "Fish" || sub.species_type === "Invert"
	);
	const plantSubmissions = submissions.filter((sub: Submission) => sub.species_type === "Plant");
	const coralSubmissions = submissions.filter((sub: Submission) => sub.species_type === "Coral");
	
	const fishTotalPoints = fishSubmissions.reduce((sum: number, sub: Submission) => sum + (sub.total_points || 0), 0);
	const plantTotalPoints = plantSubmissions.reduce((sum: number, sub: Submission) => sum + (sub.total_points || 0), 0);
	const coralTotalPoints = coralSubmissions.reduce((sum: number, sub: Submission) => sum + (sub.total_points || 0), 0);
	
	return {
		...member,
		fishTotalPoints,
		plantTotalPoints,
		coralTotalPoints
	};
}

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
	const members = await getRosterWithPoints();
	
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
	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}
	const member = await getMember(id);
	const memberWithPoints = await getMemberWithPoints(member || null);

	// Render one table row for editing
	res.render("admin/editMember", {
		member: memberWithPoints
	});
}

export const viewMemberRow = async (req: MulmRequest, res: Response) => {
	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}
	const member = await getMember(id);
	const memberWithPoints = await getMemberWithPoints(member || null);
	
	res.render("admin/singleMemberRow", { 
		member: memberWithPoints
	});
}

export const updateMemberFields = async (req: MulmRequest, res: Response) => {
	const { memberId } = req.params;
	const id = parseInt(memberId);
	if (isNaN(id)) {
		res.status(422).send("Invalid member ID");
		return;
	}

	// Parse only the editable fields (name, email, admin status)
	const { display_name, contact_email, is_admin } = req.body as { display_name: string; contact_email: string; is_admin?: string };
	await updateMember(id, {
		display_name,
		contact_email,
		is_admin: is_admin !== undefined ? 1 : 0,
	});
	
	// Get the updated member with total points
	const member = await getMember(id);
	const memberWithPoints = await getMemberWithPoints(member || null);

	res.render("admin/singleMemberRow", { 
		member: memberWithPoints
	});
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
			getBodyString(req, "content"),
		)
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
			...req.body as object,
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

	const id = getBodyParam(req, 'id') as number;
	const submission = (await getSubmissionById(id))!;

	const errors = new Map<string, string>();
	const onError = () => {
		res.render("admin/approvalPanel", {
			submission: {
				id: submission.id,
				points: submission.points,
				species_class: submission.species_class,
			},
			errors,
			name: {
				canonical_genus: getBodyString(req, 'canonical_genus'),
				canonical_species_name: getBodyString(req, 'canonical_species_name'),
			},
		});
	};

	const parsed = approvalSchema.safeParse(req.body);
	if (!validateFormResult(parsed, errors, onError)) {
		return;
	}

	const updates = parsed.data;

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
		// Get the updated submission with points included
		const updatedSubmission = await getSubmissionById(id);
		if (updatedSubmission) {
			await onSubmissionApprove(updatedSubmission, member);
			
			// Check for level upgrades after approval
			if (updatedSubmission.program) {
				try {
					await checkAndUpdateMemberLevel(
						member.id, 
						updatedSubmission.program as Program
					);
					
					// Check for specialty awards after approval
					await checkAndGrantSpecialtyAwards(member.id);
				} catch (error) {
					// Log error but don't fail the approval process
					console.error('Error checking level upgrade and specialty awards:', error);
				}
			}
		}
	}

	res.set('HX-Redirect', '/admin/queue').send();
}

export const checkMemberLevels = async (req: MulmRequest, res: Response) => {
	const memberId = parseInt(req.params.memberId);
	if (!memberId) {
		res.status(400).json({ error: 'Invalid member ID' });
		return;
	}

	try {
		const results = await checkAllMemberLevels(memberId);
		const levelChanges = Object.entries(results)
			.filter(([, result]) => result.levelChanged)
			.map(([program, result]) => ({
				program,
				oldLevel: result.oldLevel,
				newLevel: result.newLevel
			}));

		res.json({
			success: true,
			memberId,
			levelChanges,
			message: levelChanges.length > 0 
				? `Updated ${levelChanges.length} level(s) for member ${memberId}`
				: `No level changes needed for member ${memberId}`
		});
	} catch (error) {
		res.status(500).json({ 
			error: 'Failed to check member levels',
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}

export const checkMemberSpecialtyAwards = async (req: MulmRequest, res: Response) => {
	const memberId = parseInt(req.params.memberId);
	if (!memberId) {
		res.status(400).json({ error: 'Invalid member ID' });
		return;
	}

	try {
		const newAwards = await checkAllSpecialtyAwards(memberId);
		
		res.json({
			success: true,
			memberId,
			newAwards,
			totalNewAwards: newAwards.length,
			message: newAwards.length > 0 
				? `Granted ${newAwards.length} new specialty award(s) for member ${memberId}: ${newAwards.join(', ')}`
				: `No new specialty awards for member ${memberId}`
		});
	} catch (error) {
		res.status(500).json({ 
			error: 'Failed to check member specialty awards',
			details: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}


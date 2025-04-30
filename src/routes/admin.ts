import { getMember, getRoster, updateMember } from "@/db/members";
import { memberSchema } from "@/forms/member";
import { levelRules } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response, NextFunction } from "express";

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

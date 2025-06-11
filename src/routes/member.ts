import { getMemberWithAwards } from "@/db/members";
import { getSubmissionsByMember } from "@/db/submissions";
import { MulmRequest } from "@/sessions";
import { Response } from "express";

export const view = async (req: MulmRequest, res: Response) => {
	const { memberId } = req.params;
	const member = await getMemberWithAwards(memberId);
	if (!member) {
		res.status(404).send("Member not found");
		return;
	}

	// Everyone can view, but owners and admins have extra data
	const { viewer } = req;
	const isSelf = Boolean(viewer?.id == member.id);
	const isAdmin = Boolean(viewer?.is_admin);

	const submissions = await getSubmissionsByMember(
		memberId,
		isSelf,
		isSelf || isAdmin,
	);

	const fishSubs = submissions.filter(
		(sub) => sub.species_type === "Fish" || sub.species_type === "Invert",
	);
	const plantSubs = submissions.filter((sub) => sub.species_type === "Plant");
	const coralSubs = submissions.filter((sub) => sub.species_type === "Coral");

	const calculateTotalPoints = (subs: typeof submissions) => {
		let total = 0;
		for (const sub of subs) {
			total += sub.total_points || 0;
		}
		return total;
	};

	const fishTotalPoints = calculateTotalPoints(fishSubs);
	const plantTotalPoints = calculateTotalPoints(plantSubs);
	const coralTotalPoints = calculateTotalPoints(coralSubs);

	res.render("member", {
		member,
		fishSubs,
		plantSubs,
		coralSubs,
		fishTotalPoints,
		plantTotalPoints,
		coralTotalPoints,
		isLoggedIn: Boolean(viewer),
		isSelf: viewer && viewer.id == member.id,
		isAdmin: viewer && viewer.is_admin,
	});
}

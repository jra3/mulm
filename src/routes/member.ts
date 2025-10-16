import { getMemberWithAwards } from "@/db/members";
import { getSubmissionsByMember } from "@/db/submissions";
import { MulmRequest } from "@/sessions";
import { Response } from "express";
import { getSubmissionStatus } from "@/utils/submissionStatus";
import { getTrophyData } from "@/utils/awards";

export const view = async (req: MulmRequest, res: Response) => {
  const memberId = parseInt(req.params.memberId);
  if (isNaN(memberId)) {
    res.status(400).send("Invalid member ID");
    return;
  }

  const member = await getMemberWithAwards(memberId);
  if (!member) {
    res.status(404).send("Member not found");
    return;
  }

  // Everyone can view, but owners and admins have extra data
  const { viewer } = req;
  const isSelf = Boolean(viewer?.id == member.id);
  const isAdmin = Boolean(viewer?.is_admin);

  const submissions = await getSubmissionsByMember(memberId, isSelf, isSelf || isAdmin);

  // Add status info to each submission
  const submissionsWithStatus = submissions.map((sub) => ({
    ...sub,
    statusInfo: getSubmissionStatus(sub),
  }));

  const fishSubs = submissionsWithStatus.filter(
    (sub) => sub.species_type === "Fish" || sub.species_type === "Invert"
  );
  const plantSubs = submissionsWithStatus.filter((sub) => sub.species_type === "Plant");
  const coralSubs = submissionsWithStatus.filter((sub) => sub.species_type === "Coral");

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
    isSelf,
    isAdmin,
    trophyData: getTrophyData(member.awards),
  });
};

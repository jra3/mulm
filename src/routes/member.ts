import { getMemberWithAwards, getSpecialtyAwardProgress } from "@/db/members";
import { getSubmissionsByMember } from "@/db/submissions";
import { getCollectionForMember, getCollectionStats } from "@/db/collection";
import { getCaresProfile } from "@/db/cares";
import { MulmRequest } from "@/sessions";
import { Response } from "express";
import { getSubmissionStatus } from "@/utils/submissionStatus";
import { getTrophyDataWithAwards } from "@/utils/awards";

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

  // Get specialty award progress
  const progressData = await getSpecialtyAwardProgress(memberId);

  // Get collection stats (just for link/badge, not full collection)
  const collectionStats = await getCollectionStats(memberId);

  // Get CARES profile data
  const caresProfile = await getCaresProfile(memberId);

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
    trophyData: getTrophyDataWithAwards(member.awards),
    progressData,
    collectionStats,
    caresProfile,
  });
};

/**
 * View a member's species collection on dedicated page
 */
export const viewCollection = async (req: MulmRequest, res: Response) => {
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

  const { viewer } = req;
  const isSelf = Boolean(viewer?.id == member.id);
  const isAdmin = Boolean(viewer?.is_admin);

  // Get full collection data
  const includePrivate = isSelf || isAdmin;
  const collection = await getCollectionForMember(memberId, {
    includeRemoved: false,
    includePrivate,
    viewerId: viewer?.id,
  });
  const collectionStats = await getCollectionStats(memberId);

  res.render("member/collection", {
    member,
    collection,
    collectionStats,
    isLoggedIn: Boolean(viewer),
    isSelf,
    isAdmin,
    trophyData: getTrophyDataWithAwards(member.awards),
  });
};

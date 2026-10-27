import { getMemberWithAwards, getSpecialtyAwardProgress } from "@/db/members";
import { getSubmissionsByMember } from "@/db/submissions";
import { getCollectionForMember, getCollectionStats } from "@/db/collection";
import { getCaresProfile } from "@/db/cares";
import { canSeeCaresRegistry } from "@/caresRegistry";
import { MulmRequest } from "@/sessions";
import { Response } from "express";
import { getStatusPresentation } from "@/utils/statusBadge";
import { getTrophyDataWithAwards } from "@/utils/awards";
import { isInProgram } from "@/points";
import { pendingPoints } from "./submission";
import { collectionPageQuerySchema } from "@/forms/collection";

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

  // Each row's badge, and for the owner the points a witness has set but
  // the committee has not yet awarded (#523); null for every other viewer
  const submissionsWithStatus = submissions.map((sub) => ({
    ...sub,
    statusInfo: getStatusPresentation(sub),
    pendingPoints: pendingPoints(sub, viewer),
  }));

  const fishSubs = submissionsWithStatus.filter((sub) => isInProgram("fish", sub.species_type));
  const plantSubs = submissionsWithStatus.filter((sub) => isInProgram("plant", sub.species_type));
  const coralSubs = submissionsWithStatus.filter((sub) => isInProgram("coral", sub.species_type));

  // Awarded points only: a witnessed row carries its points before approval,
  // and those count toward nothing yet
  const calculateTotalPoints = (subs: typeof submissions) => {
    let total = 0;
    for (const sub of subs) {
      if (sub.approved_on == null) continue;
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

  const caresProfile = canSeeCaresRegistry(viewer) ? await getCaresProfile(memberId) : null;

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
    includeCaresRegistry: canSeeCaresRegistry(viewer),
  });
  const collectionStats = await getCollectionStats(memberId);

  // History (removed entries) is the owner's alone; anyone else gets Current.
  const requested = collectionPageQuerySchema.parse(req.query).view;
  const view = isSelf ? requested : "current";
  const history = isSelf
    ? (
        await getCollectionForMember(memberId, {
          includeRemoved: true,
          includePrivate: true,
          viewerId: viewer?.id,
        })
      ).filter((entry) => entry.removed_date !== null)
    : [];

  res.render("member/collection", {
    member,
    collection,
    collectionStats,
    view,
    history,
    isLoggedIn: Boolean(viewer),
    isSelf,
    isAdmin,
    trophyData: getTrophyDataWithAwards(member.awards),
  });
};

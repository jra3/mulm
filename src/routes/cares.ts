import { Response } from "express";
import { MulmRequest } from "@/sessions";
import { getCaresStats, isMemberCaresParticipant, getMemberCaresCount } from "@/db/cares";

export const landing = async (req: MulmRequest, res: Response) => {
  const { viewer } = req;
  const isLoggedIn = Boolean(viewer);

  const stats = await getCaresStats();

  let isParticipant = false;
  let memberSpeciesCount = 0;

  if (viewer) {
    [isParticipant, memberSpeciesCount] = await Promise.all([
      isMemberCaresParticipant(viewer.id),
      getMemberCaresCount(viewer.id),
    ]);
  }

  res.render("cares", {
    title: "CARES Fish Preservation Program",
    isLoggedIn,
    stats,
    isParticipant,
    memberSpeciesCount,
  });
};

import { Member, getMembersList, getAwardsForMembers } from "@/db/members";
import { getApprovedSubmissions, getApprovedSubmissionsInDateRange } from "@/db/submissions";
import { programs, minYear, levelRules } from "@/programs";
import { MulmRequest } from "@/sessions";
import { Response } from "express";
import { getTrophyData } from "@/utils/awards";

export const annual = async (req: MulmRequest, res: Response) => {
  const { stringYear, program = "fish" } = req.params;
  const year = parseInt(stringYear);
  if (programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  if (isNaN(year) || year < minYear) {
    res.status(422).send("Invalid year");
    return;
  }

  const startDate = new Date(year - 1, 7, 1);
  const endDate = new Date(year, 6, 31);

  const submissions = await getApprovedSubmissionsInDateRange(startDate, endDate, program);
  const names: Record<string, string> = {};
  const trophies: Record<string, ReturnType<typeof getTrophyData>> = {};

  // Collate approved submissions into standings
  const standings = new Map<number, number>();
  submissions.forEach((submission) => {
    const currentPoints = standings.get(submission.member_id) ?? 0;
    standings.set(submission.member_id, currentPoints + submission.total_points!);
    names[submission.member_id] = submission.member_name;
  });

  // Fetch awards for all members in one query
  const memberIds = Array.from(standings.keys());
  const awardsByMember = await getAwardsForMembers(memberIds);

  // Create trophy data for each member
  memberIds.forEach((memberId) => {
    const awards = awardsByMember.get(memberId) || [];
    trophies[memberId] = getTrophyData(awards);
  });

  const sortedStandings = Array.from(standings.entries()).sort((a, b) => b[1] - a[1]);

  const title = (() => {
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

  res.render("standings", {
    title,
    standings: sortedStandings,
    names,
    trophies,
    program,
    maxYear: new Date().getFullYear(),
    minYear,
    year,
    isLoggedIn: Boolean(req.viewer),
  });
};

export const lifetime = async (req: MulmRequest, res: Response) => {
  const { program = "fish" } = req.params;
  if (programs.indexOf(program) === -1) {
    res.status(404).send("Invalid program");
    return;
  }

  const levels: Record<string, Member[]> = {};
  const allSubmissions = await getApprovedSubmissions(program);
  const totals = new Map<number, number>();
  for (const record of allSubmissions) {
    totals.set(record.member_id, (totals.get(record.member_id) || 0) + record.total_points);
  }

  const members = await getMembersList();
  const trophies: Record<string, ReturnType<typeof getTrophyData>> = {};

  // Fetch awards for all members in one query
  const memberIds = members.map((m) => m.id);
  const awardsByMember = await getAwardsForMembers(memberIds);

  // Create trophy data for each member
  members.forEach((member) => {
    const awards = awardsByMember.get(member.id) || [];
    trophies[member.id] = getTrophyData(awards);
  });

  for (const member of members) {
    const memberLevel =
      (() => {
        switch (program) {
          default:
          case "fish":
            return member.fish_level;
          case "plant":
            return member.plant_level;
          case "coral":
            return member.coral_level;
        }
      })() ?? "Participant";

    if (!levels[memberLevel]) {
      levels[memberLevel] = [];
    }
    levels[memberLevel].push({
      ...member,
      points: totals.get(member.id) ?? 0,
    });
  }

  const levelsOrder = levelRules[program].map((rule) => rule[0]).reverse();
  const sortMembers = (a: Member, b: Member) => {
    const aPoints = a.points ?? 0;
    const bPoints = b.points ?? 0;
    return bPoints - aPoints;
  };

  const finalLevels = levelsOrder
    .map((name) => [
      name,
      (levels[name] ?? []).sort(sortMembers).filter((member) => member.points! > 0),
    ])
    .filter(([, members]) => members.length > 0);

  const title = (() => {
    switch (program) {
      default:
      case "fish":
        return "Breeder Awards Program";
      case "plant":
        return "Horticultural Awards Program";
      case "coral":
        return "Coral Awards Program";
    }
  })();

  res.render("lifetime", {
    title,
    levels: finalLevels,
    trophies,
    isLoggedIn: Boolean(req.viewer),
  });
};

/**
 * Award utilities for trophy display and specialty award management
 */

export type Award = {
  member_id: number;
  award_name: string;
  date_awarded: string;
  award_type?: "species" | "meta_species" | "manual";
};

export type TrophyLevel = "gold" | "silver" | "bronze" | null;

export type TrophyData = {
  icon: string;
  level: TrophyLevel;
  tooltip: string;
} | null;

/**
 * Determine trophy level based on specialty awards earned
 *
 * Trophy tiers:
 * - Gold: 7+ specialty awards OR Expert Specialist Award
 * - Silver: 4-6 specialty awards OR Senior Specialist Award
 * - Bronze: 1-3 specialty awards
 * - None: No specialty awards
 *
 * @param awards - Array of all awards for a member
 * @returns Trophy level or null if no specialty awards
 */
export function getTrophyLevel(awards: Award[]): TrophyLevel {
  const specialtyAwards = awards.filter(
    (a) => a.award_type === "species" || a.award_type === "meta_species"
  );

  if (specialtyAwards.length === 0) {
    return null;
  }

  const hasExpert = specialtyAwards.some((a) => a.award_name === "Expert Specialist Award");
  const hasSenior = specialtyAwards.some((a) => a.award_name === "Senior Specialist Award");

  // Count base specialty awards (exclude meta awards)
  const count = specialtyAwards.filter((a) => !a.award_name.includes("Specialist Award")).length;

  if (hasExpert || count >= 7) return "gold";
  if (hasSenior || count >= 4) return "silver";
  if (count >= 1) return "bronze";

  return null;
}

/**
 * Get trophy icon emoji for a given level
 */
export function getTrophyIcon(level: TrophyLevel): string {
  switch (level) {
    case "gold":
      return "🥇";
    case "silver":
      return "🥈";
    case "bronze":
      return "🥉";
    default:
      return "";
  }
}

/**
 * Format awards list for tooltip display
 */
export function formatAwardsList(awards: Award[]): string {
  const specialtyAwards = awards.filter(
    (a) => a.award_type === "species" || a.award_type === "meta_species"
  );

  return specialtyAwards.map((a) => a.award_name).join(", ");
}

/**
 * Get trophy data for displaying next to member names
 * Returns all the data Pug needs in a simple object
 *
 * @param awards - Array of all awards for a member
 * @returns Trophy data object or null if no trophy should be shown
 */
export function getTrophyData(awards: Award[] | undefined): TrophyData {
  if (!awards || awards.length === 0) {
    return null;
  }

  const level = getTrophyLevel(awards);
  if (!level) {
    return null;
  }

  return {
    icon: getTrophyIcon(level),
    level,
    tooltip: `Specialty Awards: ${formatAwardsList(awards)}`,
  };
}

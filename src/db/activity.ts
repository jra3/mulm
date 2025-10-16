import { db, query } from "./conn";
import { logger } from "@/utils/logger";
import { getAwardsForMembers } from "./members";

type AwardRecord = {
  member_id: number;
  award_name: string;
  date_awarded: string;
  award_type?: "species" | "meta_species" | "manual";
};

export interface ActivityFeedItem {
  id: number;
  activity_type: "submission_approved" | "award_granted";
  member_id: number;
  related_id: string;
  activity_data: string;
  created_at: string;

  // Joined data
  member_name?: string;
  awards?: AwardRecord[];
}

export interface SubmissionApprovedData {
  species_common_name: string;
  species_type: string;
  points: number;
  first_time_species: boolean;
  article_points?: number;
}

export interface AwardGrantedData {
  award_name: string;
  award_type: "specialty" | "meta";
}

export async function createActivity(
  activityType: "submission_approved" | "award_granted",
  memberId: number,
  relatedId: string,
  activityData: SubmissionApprovedData | AwardGrantedData
): Promise<void> {
  try {
    const conn = db(true);
    const stmt = await conn.prepare(`
            INSERT INTO activity_feed (activity_type, member_id, related_id, activity_data)
            VALUES (?, ?, ?, ?)
        `);

    try {
      await stmt.run(activityType, memberId, relatedId, JSON.stringify(activityData));
    } finally {
      await stmt.finalize();
    }

    logger.info(`Created activity: ${activityType} for member ${memberId}`);
  } catch (error) {
    logger.error("Failed to create activity feed entry", error);
    throw new Error("Failed to create activity feed entry");
  }
}

export async function getRecentActivity(limit: number = 10): Promise<ActivityFeedItem[]> {
  const activities = await query<ActivityFeedItem>(
    `
        SELECT
            af.*,
            m.display_name as member_name
        FROM activity_feed af
        JOIN members m ON af.member_id = m.id
        ORDER BY af.created_at DESC, af.id DESC
        LIMIT ?
    `,
    [limit]
  );

  // Batch fetch awards for all members in the activity feed
  const memberIds = [...new Set(activities.map((a) => a.member_id))];
  const awardsMap = await getAwardsForMembers(memberIds);

  // Attach awards to each activity
  return activities.map((activity) => ({
    ...activity,
    awards: awardsMap.get(activity.member_id) || [],
  }));
}

import { db, query } from "./conn";
import { logger } from "@/utils/logger";
import { getAwardsForMembers } from "./members";

type AwardRecord = {
  member_id: number;
  award_name: string;
  date_awarded: string;
  award_type?: "species" | "meta_species" | "manual";
};

/**
 * What an entry can announce. One entry exists for exactly as long as the
 * thing it announces does: a correction updates the approval's entry in place
 * rather than appending a second, and a revoked Award's entry is removed.
 */
export type ActivityType = "submission_approved" | "award_granted" | "level_up";

export interface ActivityFeedItem {
  id: number;
  activity_type: ActivityType;
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

export interface LevelUpData {
  program: string;
  /** The Program's member-facing name, so the feed template need not map it. */
  program_name: string;
  level: string;
  total_points: number;
}

export type ActivityData = SubmissionApprovedData | AwardGrantedData | LevelUpData;

/**
 * Record what an entry announces, creating it or refreshing it in place.
 *
 * An entry is identified by what it is about - its type, its member and its
 * related id - so announcing the same thing twice updates the one entry rather
 * than adding a second. Its `created_at` is left alone on an update, so a
 * correction does not push the approval back to the top of the front page.
 */
export async function recordActivity(
  activityType: ActivityType,
  memberId: number,
  relatedId: string,
  activityData: ActivityData
): Promise<void> {
  try {
    const conn = db(true);
    const stmt = await conn.prepare(`
            INSERT INTO activity_feed (activity_type, member_id, related_id, activity_data)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (activity_type, member_id, related_id)
            DO UPDATE SET activity_data = excluded.activity_data
        `);

    try {
      await stmt.run(activityType, memberId, relatedId, JSON.stringify(activityData));
    } finally {
      await stmt.finalize();
    }

    logger.info(`Recorded activity: ${activityType} for member ${memberId}`);
  } catch (error) {
    logger.error("Failed to record activity feed entry", error);
    throw new Error("Failed to record activity feed entry");
  }
}

/**
 * Remove the entry announcing one thing, if there is one. Used when what the
 * feed announced stops being true - a revoked Specialty Award, a deleted
 * Submission.
 */
export async function removeActivity(
  activityType: ActivityType,
  memberId: number,
  relatedId: string
): Promise<void> {
  try {
    const conn = db(true);
    const stmt = await conn.prepare(`
            DELETE FROM activity_feed
            WHERE activity_type = ? AND member_id = ? AND related_id = ?
        `);

    try {
      await stmt.run(activityType, memberId, relatedId);
    } finally {
      await stmt.finalize();
    }
  } catch (error) {
    logger.error("Failed to remove activity feed entry", error);
    throw new Error("Failed to remove activity feed entry");
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

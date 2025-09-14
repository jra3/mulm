import { makePasswordEntry, ScryptPassword } from "../auth";
import { db, query, deleteOne, insertOne, updateOne } from "./conn";
import { logger } from "@/utils/logger";
import { createActivity } from "./activity";

// type as represented in the database
export type MemberRecord = {
	id: number;
	display_name: string;
	contact_email: string;
	is_admin: number;
	fish_level?: string;
	plant_level?: string;
	coral_level?: string;
};

export type Member = MemberRecord & {
	points?: number;
};

type AwardRecord = {
	member_id: number;
	award_name: string;
	date_awarded: string;
	award_type?: 'species' | 'meta_species' | 'manual';
};

const googleAccountTableName = "google_account";

export async function getGoogleAccount(sub: string) {
  const members = await query<{
		google_sub: string,
		member_id: number,
		google_email: string,
	}>(`SELECT google_sub, member_id, google_email FROM ${googleAccountTableName} WHERE google_sub = ?`, [sub]);
  return members.pop();
}

export async function getGoogleAccountByMemberId(member_id: number) {
  const members = await query<{
		google_sub: string,
		member_id: number,
		google_email: string,
	}>(`SELECT google_sub, member_id, google_email FROM google_account WHERE member_id = ?`, [member_id]);
  return members.pop()
}

export async function createGoogleAccount(memberId: number, sub: string, email: string) {
  return insertOne(googleAccountTableName, {
    member_id: memberId,
    google_sub: sub,
    google_email: email,
  })
}

export async function deleteGoogleAccount(sub: string, memberId: number) {
  return deleteOne(googleAccountTableName, { google_sub: sub, member_id: memberId });
}

export async function createOrUpdatePassword(memberId: number, passwordEntry: ScryptPassword) {
  const conn = db(true);
  try {
    const stmt = await conn.prepare(`
			INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(member_id) DO UPDATE SET
				N = excluded.N,
				r = excluded.r,
				p = excluded.p,
				salt = excluded.salt,
				hash = excluded.hash
			`);
    try {
      const { N, r, p, salt, hash } = passwordEntry;
      await stmt.run(memberId, N, r, p, salt, hash);
    } finally {
      await stmt.finalize();
    }
  } catch (err) {
    logger.error('Failed to set password', err);
    throw new Error("Failed to set password");
  }
}

export async function getMemberPassword(memberId: number) {
  const members = await query<ScryptPassword>(`SELECT * FROM password_account WHERE member_id = ?`, [memberId]);
  return members.pop();
}

export async function createMember(
  email: string,
  name: string,
  credentials: {
		password?: string,
		google_sub?: string
	} = {},
  isAdmin: boolean = false,
) {
  const conn = db(true);
  await conn.exec('BEGIN TRANSACTION;');

  try {
    const userStmt = await conn.prepare('INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)');
    // is this a bug... we should return the data, not the lastID
    let memberId;
    try {
      memberId = (await userStmt.run(name, email, isAdmin ? 1 : 0)).lastID;
    } finally {
      await userStmt.finalize();
    }

    if (credentials.google_sub) {
      const googleStmt = await conn.prepare('INSERT INTO google_account (google_sub, member_id, google_email) VALUES (?, ?, ?)');
      try {
        await googleStmt.run(credentials.google_sub, memberId, email);
      } finally {
        await googleStmt.finalize();
      }
    }

    if (credentials.password) {
      const { N, r, p, salt, hash	} = await makePasswordEntry(credentials.password);
      const passwordStmt = await conn.prepare('INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)');
      try {
        await passwordStmt.run(memberId, N, r, p, salt, hash);
      } finally {
        await passwordStmt.finalize();
      }
    }

    await conn.exec('COMMIT;');
    return memberId as number;

  } catch (err) {
    logger.error('Failed to create member', err);
    await conn.exec('ROLLBACK;');
    throw new Error("Failed to create member");
  }
}

export async function getMember(id: number) {
  const members = await query<MemberRecord>("SELECT * FROM members WHERE id = ?",	[id]);
  return members.pop();
}

export async function updateMember(memberId: number, updates: Partial<MemberRecord>) {
  return updateOne("members", { id: memberId }, updates);
}

export async function getMemberByEmail(email: string) {
  const members = await query<MemberRecord>("SELECT * FROM members WHERE contact_email = ?", [email]);
  return members.pop();
}

export async function getMembersList(): Promise<MemberRecord[]> {
  return query<MemberRecord>("SELECT id, display_name, fish_level, plant_level, coral_level FROM members");
}

export async function getRoster() {
  return query<MemberRecord>(`SELECT * FROM members`);
}

export async function getRosterWithPoints() {
  return query<MemberRecord & { fishTotalPoints: number; plantTotalPoints: number; coralTotalPoints: number }>(`
		SELECT
			m.*,
			COALESCE(fish_points.total, 0) as fishTotalPoints,
			COALESCE(plant_points.total, 0) as plantTotalPoints,
			COALESCE(coral_points.total, 0) as coralTotalPoints
		FROM members m
		LEFT JOIN (
			SELECT
				member_id,
				SUM(
					points +
					IFNULL(article_points, 0) +
					(IFNULL(first_time_species, 0) * 5)
				) as total
			FROM submissions
			WHERE approved_on IS NOT NULL
				AND submitted_on IS NOT NULL
				AND (species_type = 'Fish' OR species_type = 'Invert')
			GROUP BY member_id
		) fish_points ON m.id = fish_points.member_id
		LEFT JOIN (
			SELECT
				member_id,
				SUM(
					points +
					IFNULL(article_points, 0) +
					(IFNULL(first_time_species, 0) * 5) +
					(IFNULL(flowered, 0) * points) +
					(IFNULL(sexual_reproduction, 0) * points)
				) as total
			FROM submissions
			WHERE approved_on IS NOT NULL
				AND submitted_on IS NOT NULL
				AND species_type = 'Plant'
			GROUP BY member_id
		) plant_points ON m.id = plant_points.member_id
		LEFT JOIN (
			SELECT
				member_id,
				SUM(
					points +
					IFNULL(article_points, 0) +
					(IFNULL(first_time_species, 0) * 5)
				) as total
			FROM submissions
			WHERE approved_on IS NOT NULL
				AND submitted_on IS NOT NULL
				AND species_type = 'Coral'
			GROUP BY member_id
		) coral_points ON m.id = coral_points.member_id
		ORDER BY m.display_name
	`);
}

/**
 * Search for members by name or email with database-level filtering
 * @param searchQuery - The search term to match against display_name and contact_email
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Array of matching member records
 */
export async function searchMembers(searchQuery: string, limit: number = 10): Promise<MemberRecord[]> {
  if (!searchQuery || searchQuery.trim().length < 2) {
    return [];
  }

  const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;

  return query<MemberRecord>(`
		SELECT * FROM members
		WHERE LOWER(display_name) LIKE ?
		   OR LOWER(contact_email) LIKE ?
		ORDER BY display_name
		LIMIT ?
	`, [searchPattern, searchPattern, limit]);
}

export async function getMemberWithAwards(memberId: string) {
  const [members, awards] = await Promise.all([
    query<MemberRecord>("SELECT * FROM members WHERE id = ?", [memberId]),
    query<AwardRecord>("SELECT * FROM awards WHERE member_id = ?", [memberId]),
  ]);
  const member = members.pop();
  return { ...member, awards };
}

export async function grantAward(
  memberId: number,
  awardName: string,
  dateAwarded: Date,
  awardType: 'species' | 'meta_species' | 'manual' = 'species'
) {
  try {
    const conn = db(true);
    const stmt = await conn.prepare("INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, ?, ?)");
    try {
      await stmt.run(memberId, awardName, dateAwarded.toISOString(), awardType);
    } finally {
      await stmt.finalize();
    }

    // Create activity feed entry for award grant
    try {
      // Determine award type based on name
      const isMetaAward = awardName.includes('Senior Specialist') || awardName.includes('Expert Specialist');

      await createActivity(
        'award_granted',
        memberId,
        awardName,
        {
          award_name: awardName,
          award_type: isMetaAward ? 'meta' : 'specialty'
        }
      );
    } catch (activityError) {
      logger.error('Failed to create activity feed entry for award', activityError);
      // Don't fail the award grant if activity creation fails
    }
  } catch (err) {
    logger.error('Failed to grant award', err);
    throw new Error("Failed to grant award");
  }
}

// Currently this is a full table scan. Oh well.
export async function getAdminEmails(): Promise<string[]> {
  const rows = await query<{ contact_email: string }>(`SELECT contact_email FROM members where is_admin = 1`);
  return rows.map((row) => row.contact_email);
}

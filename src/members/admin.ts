/**
 * The committee's operations on Member records, as the admin API (#595)
 * exposes them: search, a detail view with logins, editing the name and
 * address, deleting, and granting or revoking admin. Ported from the member
 * MCP tools. Merging lives in ./merge.ts. Who may do what (an admin acting on
 * themselves) is the caller's business.
 */
import { query, withTransaction } from "../db/conn";
import { getMember, type MemberRecord } from "../db/members";
import { revokeMemberAdminTokens } from "../db/adminTokens";
import { containsPattern, containsSql } from "../db/likePattern";
import { anyProgramSpeciesTypeSql, totalPointsSql } from "../points";

export type MemberFilters = {
  /** Matches name or email; ignored under two characters, as everywhere else. */
  query?: string;
  is_admin?: boolean;
  /** Whether the member has any approved Submission. */
  has_submissions?: boolean;
  limit: number;
  offset: number;
};

export type MemberSummary = {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  /** Approved Submissions. */
  submission_count: number;
  fish_level: string | null;
  plant_level: string | null;
  coral_level: string | null;
};

export async function listMembers(filters: MemberFilters): Promise<MemberSummary[]> {
  const conditions: string[] = ["1=1"];
  const params: (string | number)[] = [];

  if (filters.is_admin !== undefined) {
    conditions.push("m.is_admin = ?");
    params.push(filters.is_admin ? 1 : 0);
  }
  if (filters.query && filters.query.trim().length >= 2) {
    const pattern = containsPattern(filters.query);
    conditions.push(`(${containsSql("m.display_name")} OR ${containsSql("m.contact_email")})`);
    params.push(pattern, pattern);
  }
  const having =
    filters.has_submissions === undefined
      ? ""
      : filters.has_submissions
        ? "HAVING submission_count > 0"
        : "HAVING submission_count = 0";

  const rows = await query<MemberRecord & { submission_count: number }>(
    `SELECT m.*, COUNT(s.id) AS submission_count
     FROM members m
     LEFT JOIN submissions s ON m.id = s.member_id AND s.approved_on IS NOT NULL
     WHERE ${conditions.join(" AND ")}
     GROUP BY m.id
     ${having}
     ORDER BY m.display_name, m.id
     LIMIT ? OFFSET ?`,
    [...params, filters.limit, filters.offset]
  );
  return rows.map((m) => ({
    id: m.id,
    email: m.contact_email,
    display_name: m.display_name,
    is_admin: Boolean(m.is_admin),
    submission_count: m.submission_count,
    fish_level: m.fish_level ?? null,
    plant_level: m.plant_level ?? null,
    coral_level: m.coral_level ?? null,
  }));
}

export type MemberDetail = {
  id: number;
  email: string;
  display_name: string;
  is_admin: boolean;
  fish_level: string | null;
  plant_level: string | null;
  coral_level: string | null;
  /** How the member can log in; null where they have no login of that kind. */
  logins: {
    password: boolean;
    google: { email: string } | null;
    apple: { email: string } | null;
  };
  submission_count: number;
  approved_submission_count: number;
  /** Awarded points across all three Programs, by the one Points rule. */
  total_points: number;
  awards: string[];
  tank_presets: string[];
};

export async function getMemberDetail(memberId: number): Promise<MemberDetail | undefined> {
  const member = await getMember(memberId);
  if (!member) return undefined;

  const [counts] = await query<{ submissions: number; approved: number }>(
    `SELECT COUNT(*) AS submissions, COUNT(approved_on) AS approved
     FROM submissions WHERE member_id = ?`,
    [memberId]
  );
  // Filtered exactly as the per-program roster totals are (src/db/members.ts),
  // so this equals fish + plant + coral.
  const [points] = await query<{ total: number | null }>(
    `SELECT SUM(${totalPointsSql("submissions")}) AS total
     FROM submissions
     WHERE submissions.member_id = ?
       AND submissions.approved_on IS NOT NULL
       AND submissions.submitted_on IS NOT NULL
       AND ${anyProgramSpeciesTypeSql("submissions")}`,
    [memberId]
  );
  const [logins] = await query<{
    has_password: number;
    google_email: string | null;
    apple_email: string | null;
    has_google: number;
    has_apple: number;
  }>(
    `SELECT
       EXISTS (SELECT 1 FROM password_account WHERE member_id = ?) AS has_password,
       EXISTS (SELECT 1 FROM google_account WHERE member_id = ?) AS has_google,
       (SELECT google_email FROM google_account WHERE member_id = ?) AS google_email,
       EXISTS (SELECT 1 FROM apple_account WHERE member_id = ?) AS has_apple,
       (SELECT apple_email FROM apple_account WHERE member_id = ?) AS apple_email`,
    [memberId, memberId, memberId, memberId, memberId]
  );
  const awards = await query<{ award_name: string }>(
    "SELECT award_name FROM awards WHERE member_id = ? ORDER BY date_awarded DESC",
    [memberId]
  );
  const presets = await query<{ preset_name: string }>(
    "SELECT preset_name FROM tank_presets WHERE member_id = ? ORDER BY preset_name",
    [memberId]
  );

  return {
    id: member.id,
    email: member.contact_email,
    display_name: member.display_name,
    is_admin: Boolean(member.is_admin),
    fish_level: member.fish_level ?? null,
    plant_level: member.plant_level ?? null,
    coral_level: member.coral_level ?? null,
    logins: {
      password: logins.has_password === 1,
      google: logins.has_google ? { email: logins.google_email ?? "" } : null,
      apple: logins.has_apple ? { email: logins.apple_email ?? "" } : null,
    },
    submission_count: counts?.submissions ?? 0,
    approved_submission_count: counts?.approved ?? 0,
    total_points: points?.total ?? 0,
    awards: awards.map((a) => a.award_name),
    tank_presets: presets.map((p) => p.preset_name),
  };
}

/** Another member already holds the address, compared without regard to case. */
export class EmailTakenError extends Error {}

/**
 * Change a member's display name and/or contact address. Returns undefined
 * when there is no such member.
 */
export async function updateMemberDetails(
  memberId: number,
  changes: { display_name?: string; contact_email?: string }
): Promise<MemberDetail | undefined> {
  if (!(await getMember(memberId))) return undefined;
  const fields = Object.entries(changes).filter(([, value]) => value !== undefined);
  await withTransaction(async (db) => {
    if (changes.contact_email !== undefined) {
      const holder = await db.get<{ id: number }>(
        "SELECT id FROM members WHERE contact_email = ? COLLATE NOCASE AND id != ?",
        [changes.contact_email, memberId]
      );
      if (holder) throw new EmailTakenError(`Member ${holder.id} already has that email address`);
    }
    await db.run(
      `UPDATE members SET ${fields.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`,
      [...fields.map(([, value]) => value), memberId]
    );
  });
  return getMemberDetail(memberId);
}

/** The member has approved Submissions and the delete was not forced. */
export class MemberHasApprovedSubmissionsError extends Error {
  constructor(readonly approvedCount: number) {
    super(`Member has ${approvedCount} approved submissions; pass force=true to delete anyway`);
  }
}

export type DeletedMember = {
  id: number;
  display_name: string;
  submission_count: number;
  approved_submission_count: number;
  admin_tokens_revoked: number;
};

/**
 * Delete a member, refusing one with approved Submissions unless forced. The
 * member's admin API tokens are revoked in the same transaction. Like the MCP
 * tool this replaces, it deletes only the members row; with foreign keys
 * unenforced in production their Submissions and logins are left behind.
 * Returns undefined when there is no such member.
 */
export async function deleteMember(
  memberId: number,
  options: { force: boolean }
): Promise<DeletedMember | undefined> {
  const member = await getMember(memberId);
  if (!member) return undefined;
  const [counts] = await query<{ submissions: number; approved: number }>(
    `SELECT COUNT(*) AS submissions, COUNT(approved_on) AS approved
     FROM submissions WHERE member_id = ?`,
    [memberId]
  );
  const approved = counts?.approved ?? 0;
  if (approved > 0 && !options.force) throw new MemberHasApprovedSubmissionsError(approved);

  const revoked = await withTransaction(async (db) => {
    const count = await revokeMemberAdminTokens(db, memberId);
    await db.run("DELETE FROM members WHERE id = ?", [memberId]);
    return count;
  });
  return {
    id: member.id,
    display_name: member.display_name,
    submission_count: counts?.submissions ?? 0,
    approved_submission_count: approved,
    admin_tokens_revoked: revoked,
  };
}

/**
 * Grant or revoke admin. A demoted member's admin API tokens are left as they
 * are: every request re-checks admin, so they are refused while the member is
 * not an admin. Returns undefined when there is no such member.
 */
export async function setAdminStatus(
  memberId: number,
  isAdmin: boolean
): Promise<{ id: number; display_name: string; is_admin: boolean } | undefined> {
  const member = await getMember(memberId);
  if (!member) return undefined;
  await withTransaction(async (db) => {
    await db.run("UPDATE members SET is_admin = ? WHERE id = ?", [isAdmin ? 1 : 0, memberId]);
  });
  return { id: member.id, display_name: member.display_name, is_admin: isAdmin };
}

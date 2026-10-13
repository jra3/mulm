/**
 * Member Management MCP Server - Core Logic
 *
 * Provides reusable server initialization for both stdio and HTTP transports.
 * This module exports the server setup function that can be used by different transport layers.
 */

import { z } from "zod";
import { defineTool, registerTools, positiveId } from "./tools";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { query, withTransaction } from "../db/conn";
import { mergeMembers } from "../members/merge";
import { containsPattern, containsSql } from "../db/likePattern";
import { anyProgramSpeciesTypeSql, totalPointsSql } from "../points";

// Type definitions
type Member = {
  id: number;
  contact_email: string;
  display_name: string;
  is_admin: number;
  fish_level: string | null;
  plant_level: string | null;
  coral_level: string | null;
};

type MemberDetail = Member & {
  has_password: boolean;
  has_google_oauth: boolean;
  submission_count: number;
  approved_submission_count: number;
  total_points: number;
  award_count: number;
  tank_preset_count: number;
};

const listMembersSchema = z.object({
  query: z.string().describe("Search text (searches name and email)").optional(),
  is_admin: z.boolean().describe("Filter by admin status").optional(),
  has_submissions: z.boolean().describe("Filter members with submissions").optional(),
  limit: z.number().int().nonnegative().describe("Max results (default: 100)").optional(),
  offset: z.number().int().nonnegative().describe("Skip results (default: 0)").optional(),
});

const getMemberDetailSchema = z.object({
  member_id: positiveId.describe("Member ID"),
});

const mergeMembersSchema = z.object({
  from_member_id: positiveId.describe("Member to delete (source)"),
  to_member_id: positiveId.describe("Member to keep (destination)"),
  preview: z.boolean().describe("Preview changes without executing (default: false)").optional(),
});

const updateMemberSchema = z
  .object({
    member_id: positiveId.describe("Member ID"),
    contact_email: z.string().describe("New email address (optional)").optional(),
    display_name: z.string().describe("New display name (optional)").optional(),
  })
  .and(z.union([z.object({ contact_email: z.string() }), z.object({ display_name: z.string() })]));

const deleteMemberSchema = z.object({
  member_id: positiveId.describe("Member ID"),
  force: z
    .boolean()
    .describe("Force delete even if member has approved submissions (default: false)")
    .optional(),
});

const setAdminStatusSchema = z.object({
  member_id: positiveId.describe("Member ID"),
  is_admin: z.boolean().describe("Admin status"),
});

/**
 * Initialize the Member Management MCP server with all handlers and tools.
 * This function is transport-agnostic and can be used with stdio or HTTP.
 */
export function initializeMemberServer(server: Server): void {
  /**
   * LIST RESOURCES HANDLER
   */
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "members://list",
          name: "All Members",
          description: "List all members with basic information",
          mimeType: "application/json",
        },
        {
          uri: "members://admins",
          name: "Admin Members",
          description: "List all admin members",
          mimeType: "application/json",
        },
        {
          uri: "members://statistics",
          name: "Member Statistics",
          description: "Get aggregate statistics about members",
          mimeType: "application/json",
        },
      ],
    };
  });

  /**
   * READ RESOURCE HANDLER
   */
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    try {
      // members://list
      if (uri === "members://list") {
        const members = await query<Member & { submission_count: number }>(`
          SELECT m.*, COUNT(s.id) as submission_count
          FROM members m
          LEFT JOIN submissions s ON m.id = s.member_id AND s.approved_on IS NOT NULL
          GROUP BY m.id
          ORDER BY m.display_name
        `);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(members, null, 2),
            },
          ],
        };
      }

      // members://admins
      if (uri === "members://admins") {
        const admins = await query<Member>(`
          SELECT * FROM members
          WHERE is_admin = 1
          ORDER BY display_name
        `);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(admins, null, 2),
            },
          ],
        };
      }

      // members://{member_id}
      const memberMatch = uri.match(/^members:\/\/(\d+)$/);
      if (memberMatch) {
        const memberId = parseInt(memberMatch[1]);
        const members = await query<Member>("SELECT * FROM members WHERE id = ?", [memberId]);
        if (members.length === 0) {
          throw new Error(`Member ${memberId} not found`);
        }
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(members[0], null, 2),
            },
          ],
        };
      }

      // members://statistics
      if (uri === "members://statistics") {
        const totalCount = await query<{ count: number }>("SELECT COUNT(*) as count FROM members");
        const adminCount = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM members WHERE is_admin = 1"
        );
        const withPassword = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM password_account"
        );
        const withGoogle = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM google_account"
        );
        const withApple = await query<{ count: number }>(
          "SELECT COUNT(*) as count FROM apple_account"
        );
        const activeMembers = await query<{ count: number }>(`
          SELECT COUNT(DISTINCT member_id) as count FROM submissions WHERE approved_on IS NOT NULL
        `);

        const statistics = {
          total_members: totalCount[0].count,
          admin_count: adminCount[0].count,
          with_password: withPassword[0].count,
          with_google_oauth: withGoogle[0].count,
          with_apple_oauth: withApple[0].count,
          active_members: activeMembers[0].count,
        };

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(statistics, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to read resource ${uri}: ${message}`, { cause: error });
    }
  });

  registerTools(server, [
    defineTool(
      "list_members",
      "Search and list members with optional filters",
      listMembersSchema,
      handleListMembers
    ),
    defineTool(
      "get_member_detail",
      "Get comprehensive details for a member including submissions, awards, and credentials",
      getMemberDetailSchema,
      handleGetMemberDetail
    ),
    defineTool(
      "merge_members",
      "Merge two member accounts (moves all data from one member to another)",
      mergeMembersSchema,
      handleMergeMembers
    ),
    defineTool(
      "update_member",
      "Update member information (email, display name)",
      updateMemberSchema,
      handleUpdateMember
    ),
    defineTool(
      "delete_member",
      "Delete a member account with safety checks",
      deleteMemberSchema,
      handleDeleteMember
    ),
    defineTool(
      "set_admin_status",
      "Grant or revoke admin privileges",
      setAdminStatusSchema,
      handleSetAdminStatus
    ),
  ]);
}

/**
 * TOOL IMPLEMENTATIONS
 */

async function handleListMembers(args: z.infer<typeof listMembersSchema>) {
  const { query: searchQuery, is_admin, has_submissions, limit = 100, offset = 0 } = args;

  const conditions: string[] = ["1=1"];
  const params: (string | number)[] = [];

  if (is_admin !== undefined) {
    conditions.push("m.is_admin = ?");
    params.push(is_admin ? 1 : 0);
  }

  if (searchQuery && typeof searchQuery === "string" && searchQuery.trim().length >= 2) {
    const searchPattern = containsPattern(searchQuery);
    conditions.push(`(${containsSql("m.display_name")} OR ${containsSql("m.contact_email")})`);
    params.push(searchPattern, searchPattern);
  }

  let sql = `
    SELECT m.*, COUNT(s.id) as submission_count
    FROM members m
    LEFT JOIN submissions s ON m.id = s.member_id AND s.approved_on IS NOT NULL
    WHERE ${conditions.join(" AND ")}
    GROUP BY m.id
  `;

  if (has_submissions !== undefined) {
    sql += has_submissions ? " HAVING submission_count > 0" : " HAVING submission_count = 0";
  }

  sql += ` ORDER BY m.display_name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const results = await query<Member & { submission_count: number }>(sql, params);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            count: results.length,
            members: results.map((m) => ({
              id: m.id,
              email: m.contact_email,
              display_name: m.display_name,
              is_admin: Boolean(m.is_admin),
              submission_count: m.submission_count,
              fish_level: m.fish_level,
              plant_level: m.plant_level,
              coral_level: m.coral_level,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleGetMemberDetail(args: z.infer<typeof getMemberDetailSchema>) {
  const { member_id } = args;

  const members = await query<Member>("SELECT * FROM members WHERE id = ?", [member_id]);

  if (members.length === 0) {
    throw new Error(`Member ${member_id} not found`);
  }

  const member = members[0];

  // Get submission counts
  const submissions = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ?",
    [member_id]
  );

  const approvedSubmissions = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ? AND approved_on IS NOT NULL",
    [member_id]
  );

  // A cross-program grand total, filtered exactly as the per-program roster
  // totals are (src/db/members.ts), so this equals fish + plant + coral rather
  // than merely happening to match on today's data.
  const totalPoints = await query<{ total: number }>(
    `
    SELECT SUM(${totalPointsSql("submissions")}) as total
    FROM submissions
    WHERE submissions.member_id = ?
      AND submissions.approved_on IS NOT NULL
      AND submissions.submitted_on IS NOT NULL
      AND ${anyProgramSpeciesTypeSql("submissions")}
  `,
    [member_id]
  );

  // Check credentials
  const hasPassword = await query<{ member_id: number }>(
    "SELECT member_id FROM password_account WHERE member_id = ?",
    [member_id]
  );

  const hasGoogle = await query<{ member_id: number; google_email: string }>(
    "SELECT member_id, google_email FROM google_account WHERE member_id = ?",
    [member_id]
  );

  // Get awards
  const awards = await query<{ award_name: string; date_awarded: string }>(
    "SELECT award_name, date_awarded FROM awards WHERE member_id = ? ORDER BY date_awarded DESC",
    [member_id]
  );

  // Get tank presets
  const tankPresets = await query<{ preset_name: string }>(
    "SELECT preset_name FROM tank_presets WHERE member_id = ? ORDER BY preset_name",
    [member_id]
  );

  const detail: MemberDetail = {
    ...member,
    has_password: hasPassword.length > 0,
    has_google_oauth: hasGoogle.length > 0,
    submission_count: submissions[0]?.count || 0,
    approved_submission_count: approvedSubmissions[0]?.count || 0,
    total_points: totalPoints[0]?.total || 0,
    award_count: awards.length,
    tank_preset_count: tankPresets.length,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            member: {
              ...detail,
              is_admin: Boolean(detail.is_admin),
              google_email: hasGoogle[0]?.google_email,
              awards: awards.map((a) => a.award_name),
              tank_presets: tankPresets.map((t) => t.preset_name),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleMergeMembers(args: z.infer<typeof mergeMembersSchema>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(await mergeMembers(args), null, 2) }],
  };
}

async function handleUpdateMember(args: z.infer<typeof updateMemberSchema>) {
  const { member_id, contact_email, display_name } = args;

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (contact_email !== undefined && typeof contact_email === "string") {
    updates.push("contact_email = ?");
    values.push(contact_email.trim());
  }
  if (display_name !== undefined && typeof display_name === "string") {
    updates.push("display_name = ?");
    values.push(display_name.trim());
  }

  if (updates.length === 0) {
    throw new Error("No fields to update");
  }

  values.push(member_id);

  await withTransaction(async (db) => {
    const stmt = await db.prepare(`
      UPDATE members
      SET ${updates.join(", ")}
      WHERE id = ?
    `);
    await stmt.run(...values);
    await stmt.finalize();
  });

  // Fetch updated member
  const updated = await query<Member>("SELECT * FROM members WHERE id = ?", [member_id]);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            member: updated[0],
            message: "Member updated successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleDeleteMember(args: z.infer<typeof deleteMemberSchema>) {
  const { member_id, force } = args;

  // Check if member exists
  const members = await query<Member>("SELECT * FROM members WHERE id = ?", [member_id]);
  if (members.length === 0) {
    throw new Error(`Member ${member_id} not found`);
  }

  // Check for approved submissions
  const approvedSubmissions = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ? AND approved_on IS NOT NULL",
    [member_id]
  );

  const approvedCount = approvedSubmissions[0]?.count || 0;

  if (approvedCount > 0 && !force) {
    throw new Error(
      `Member has ${approvedCount} approved submissions. Use force: true to delete anyway.`
    );
  }

  // Get submission count before delete
  const allSubmissions = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ?",
    [member_id]
  );

  const submissionCount = allSubmissions[0]?.count || 0;

  await withTransaction(async (db) => {
    const stmt = await db.prepare("DELETE FROM members WHERE id = ?");
    await stmt.run(member_id);
    await stmt.finalize();
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            member_id,
            deleted_member: members[0].display_name,
            warning:
              submissionCount > 0
                ? `Member had ${submissionCount} submissions (${approvedCount} approved)`
                : undefined,
            message: "Member deleted successfully",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleSetAdminStatus(args: z.infer<typeof setAdminStatusSchema>) {
  const { member_id, is_admin } = args;

  const members = await query<Member>("SELECT * FROM members WHERE id = ?", [member_id]);
  if (members.length === 0) {
    throw new Error(`Member ${member_id} not found`);
  }

  await withTransaction(async (db) => {
    const stmt = await db.prepare("UPDATE members SET is_admin = ? WHERE id = ?");
    await stmt.run(is_admin ? 1 : 0, member_id);
    await stmt.finalize();
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            member_id,
            display_name: members[0].display_name,
            is_admin,
            message: `Admin status ${is_admin ? "granted" : "revoked"}`,
          },
          null,
          2
        ),
      },
    ],
  };
}

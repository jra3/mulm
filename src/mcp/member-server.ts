#!/usr/bin/env node

/**
 * Member Management MCP Server
 *
 * Provides Model Context Protocol tools and resources for managing
 * members in the BAP/HAP application.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { query, withTransaction } from "../db/conn.js";
import { logger } from "../utils/logger.js";

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

// Create MCP server
const server = new Server(
  {
    name: "member-management",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

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
      const activeMembers = await query<{ count: number }>(`
        SELECT COUNT(DISTINCT member_id) as count FROM submissions WHERE approved_on IS NOT NULL
      `);

      const statistics = {
        total_members: totalCount[0].count,
        admin_count: adminCount[0].count,
        with_password: withPassword[0].count,
        with_google_oauth: withGoogle[0].count,
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
    throw new Error(`Failed to read resource ${uri}: ${message}`);
  }
});

/**
 * LIST TOOLS HANDLER
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_members",
        description: "Search and list members with optional filters",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text (searches name and email)" },
            is_admin: { type: "boolean", description: "Filter by admin status" },
            has_submissions: { type: "boolean", description: "Filter members with submissions" },
            limit: { type: "number", description: "Max results (default: 100)" },
            offset: { type: "number", description: "Skip results (default: 0)" },
          },
        },
      },
      {
        name: "get_member_detail",
        description:
          "Get comprehensive details for a member including submissions, awards, and credentials",
        inputSchema: {
          type: "object",
          properties: {
            member_id: { type: "number", description: "Member ID" },
          },
          required: ["member_id"],
        },
      },
      {
        name: "merge_members",
        description: "Merge two member accounts (moves all data from one member to another)",
        inputSchema: {
          type: "object",
          properties: {
            from_member_id: { type: "number", description: "Member to delete (source)" },
            to_member_id: { type: "number", description: "Member to keep (destination)" },
            preview: {
              type: "boolean",
              description: "Preview changes without executing (default: false)",
            },
          },
          required: ["from_member_id", "to_member_id"],
        },
      },
      {
        name: "update_member",
        description: "Update member information (email, display name)",
        inputSchema: {
          type: "object",
          properties: {
            member_id: { type: "number", description: "Member ID" },
            contact_email: { type: "string", description: "New email address (optional)" },
            display_name: { type: "string", description: "New display name (optional)" },
          },
          required: ["member_id"],
        },
      },
      {
        name: "delete_member",
        description: "Delete a member account with safety checks",
        inputSchema: {
          type: "object",
          properties: {
            member_id: { type: "number", description: "Member ID" },
            force: {
              type: "boolean",
              description: "Force delete even if member has approved submissions (default: false)",
            },
          },
          required: ["member_id"],
        },
      },
      {
        name: "set_admin_status",
        description: "Grant or revoke admin privileges",
        inputSchema: {
          type: "object",
          properties: {
            member_id: { type: "number", description: "Member ID" },
            is_admin: { type: "boolean", description: "Admin status" },
          },
          required: ["member_id", "is_admin"],
        },
      },
    ],
  };
});

/**
 * CALL TOOL HANDLER
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_members":
        return await handleListMembers(args);
      case "get_member_detail":
        return await handleGetMemberDetail(args);
      case "merge_members":
        return await handleMergeMembers(args);
      case "update_member":
        return await handleUpdateMember(args);
      case "delete_member":
        return await handleDeleteMember(args);
      case "set_admin_status":
        return await handleSetAdminStatus(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: false,
              error: message,
              error_code: "TOOL_EXECUTION_ERROR",
            },
            null,
            2
          ),
        },
      ],
    };
  }
});

/**
 * TOOL IMPLEMENTATIONS
 */

async function handleListMembers(args: any) {
  const { query: searchQuery, is_admin, has_submissions, limit = 100, offset = 0 } = args;

  const conditions: string[] = ["1=1"];
  const params: any[] = [];

  if (is_admin !== undefined) {
    conditions.push("m.is_admin = ?");
    params.push(is_admin ? 1 : 0);
  }

  if (searchQuery && searchQuery.trim().length >= 2) {
    const searchPattern = `%${searchQuery.trim().toLowerCase()}%`;
    conditions.push("(LOWER(m.display_name) LIKE ? OR LOWER(m.contact_email) LIKE ?)");
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

async function handleGetMemberDetail(args: any) {
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

  const totalPoints = await query<{ total: number }>(
    `
    SELECT SUM(
      points +
      IFNULL(article_points, 0) +
      (IFNULL(first_time_species, 0) * 5) +
      (IFNULL(flowered, 0) * points) +
      (IFNULL(sexual_reproduction, 0) * points)
    ) as total
    FROM submissions
    WHERE member_id = ? AND approved_on IS NOT NULL
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

async function handleMergeMembers(args: any) {
  const { from_member_id, to_member_id, preview } = args;

  if (from_member_id === to_member_id) {
    throw new Error("Cannot merge a member into itself");
  }

  // Get both members
  const fromMembers = await query<Member>("SELECT * FROM members WHERE id = ?", [from_member_id]);
  const toMembers = await query<Member>("SELECT * FROM members WHERE id = ?", [to_member_id]);

  if (fromMembers.length === 0) {
    throw new Error(`Source member ${from_member_id} not found`);
  }
  if (toMembers.length === 0) {
    throw new Error(`Destination member ${to_member_id} not found`);
  }

  const fromMember = fromMembers[0];
  const toMember = toMembers[0];

  // Get counts for preview
  const submissionCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM submissions WHERE member_id = ?",
    [from_member_id]
  );

  const awardCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM awards WHERE member_id = ?",
    [from_member_id]
  );

  const tankPresetCount = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM tank_presets WHERE member_id = ?",
    [from_member_id]
  );

  const previewData = {
    from_member: {
      id: fromMember.id,
      email: fromMember.contact_email,
      display_name: fromMember.display_name,
      submission_count: submissionCount[0]?.count || 0,
      award_count: awardCount[0]?.count || 0,
      tank_preset_count: tankPresetCount[0]?.count || 0,
    },
    to_member: {
      id: toMember.id,
      email: toMember.contact_email,
      display_name: toMember.display_name,
    },
    actions: [
      `Move ${submissionCount[0]?.count || 0} submissions`,
      `Move ${awardCount[0]?.count || 0} awards`,
      `Move ${tankPresetCount[0]?.count || 0} tank presets`,
      `Delete member ${from_member_id}`,
    ],
  };

  if (preview) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              preview: true,
              preview_data: previewData,
              message: "Preview of merge operation (no changes made)",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Execute merge
  const results = await withTransaction(async (db) => {
    // Migrate submissions
    const subStmt = await db.prepare("UPDATE submissions SET member_id = ? WHERE member_id = ?");
    const subResult = await subStmt.run(to_member_id, from_member_id);
    await subStmt.finalize();

    // Migrate awards
    const awardStmt = await db.prepare("UPDATE awards SET member_id = ? WHERE member_id = ?");
    const awardResult = await awardStmt.run(to_member_id, from_member_id);
    await awardStmt.finalize();

    // Migrate tank presets
    const tankStmt = await db.prepare("UPDATE tank_presets SET member_id = ? WHERE member_id = ?");
    const tankResult = await tankStmt.run(to_member_id, from_member_id);
    await tankStmt.finalize();

    // Delete source member (cascades to password_account, google_account, sessions, auth_codes)
    const deleteStmt = await db.prepare("DELETE FROM members WHERE id = ?");
    await deleteStmt.run(from_member_id);
    await deleteStmt.finalize();

    return {
      submissions_moved: subResult.changes,
      awards_moved: awardResult.changes,
      tank_presets_moved: tankResult.changes,
    };
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            from_member_id,
            to_member_id,
            ...results,
            preview_data: previewData,
            message: `Member ${from_member_id} merged into ${to_member_id} successfully`,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function handleUpdateMember(args: any) {
  const { member_id, contact_email, display_name } = args;

  const updates: string[] = [];
  const values: any[] = [];

  if (contact_email !== undefined) {
    updates.push("contact_email = ?");
    values.push(contact_email.trim());
  }
  if (display_name !== undefined) {
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

async function handleDeleteMember(args: any) {
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

async function handleSetAdminStatus(args: any) {
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

/**
 * START SERVER
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Member Management MCP Server running on stdio");
}

main().catch((error) => {
  logger.error("Server error:", error);
  process.exit(1);
});

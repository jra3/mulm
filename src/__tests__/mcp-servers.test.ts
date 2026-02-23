/**
 * MCP Server Core Logic Tests
 *
 * Tests the handler logic for member-server-core.ts and species-server-core.ts
 * using an in-memory SQLite database. Does NOT test full MCP protocol — only
 * that handler functions produce correct outputs for given inputs.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { overrideConnection } from "../db/conn";
import { initializeMemberServer } from "../mcp/member-server-core";
import { initializeSpeciesServer } from "../mcp/species-server-core";

// ─── Mock MCP Server ─────────────────────────────────────────────────────────

type RequestHandler = (request: { params: Record<string, unknown> }) => Promise<unknown>;

/**
 * Minimal mock of the MCP Server class that captures registered handlers
 * so we can invoke them directly in tests.
 *
 * Uses the same schema object references as the source modules (imported at
 * the top of the file) so that Map lookups match correctly.
 */
function createMockServer() {
  const handlers = new Map<object, RequestHandler>();

  return {
    setRequestHandler(schema: object, handler: RequestHandler) {
      handlers.set(schema, handler);
    },
    async callTool(name: string, args: Record<string, unknown>) {
      const handler = handlers.get(CallToolRequestSchema);
      if (!handler) throw new Error("No CallTool handler registered");
      return handler({ params: { name, arguments: args } });
    },
    async readResource(uri: string) {
      const handler = handlers.get(ReadResourceRequestSchema);
      if (!handler) throw new Error("No ReadResource handler registered");
      return handler({ params: { uri } });
    },
    async listTools() {
      const handler = handlers.get(ListToolsRequestSchema);
      if (!handler) throw new Error("No ListTools handler registered");
      return handler({ params: {} });
    },
    async listResources() {
      const handler = handlers.get(ListResourcesRequestSchema);
      if (!handler) throw new Error("No ListResources handler registered");
      return handler({ params: {} });
    },
  };
}

type MockServer = ReturnType<typeof createMockServer>;

function parseResult(result: unknown): Record<string, unknown> {
  const r = result as { content: [{ type: string; text: string }] };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(r.content[0].text);
}

// ─── DB Setup Helpers ─────────────────────────────────────────────────────────

let db: Database;
let memberId1: number;
let memberId2: number;

async function setup() {
  db = await open({ filename: ":memory:", driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.migrate({ migrationsPath: "./db/migrations" });
  overrideConnection(db);

  const m1 = await db.run(
    "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
    ["Alice", "alice@test.com"]
  );
  memberId1 = m1.lastID as number;

  const m2 = await db.run(
    "INSERT INTO members (display_name, contact_email) VALUES (?, ?)",
    ["Bob", "bob@test.com"]
  );
  memberId2 = m2.lastID as number;
}

async function teardown() {
  try {
    await db.close();
  } catch {
    // ignore
  }
}

// ─── Member Server Tests ──────────────────────────────────────────────────────

void describe("member-server-core", () => {
  let server: MockServer;

  beforeEach(async () => {
    await setup();
    server = createMockServer();
    initializeMemberServer(server as never);
  });

  afterEach(teardown);

  void describe("list_members", () => {
    void test("should list all members", async () => {
      const result = parseResult(await server.callTool("list_members", {}));
      assert.equal(result.success, true);
      assert.equal(result.count, 2);
      const members = result.members as Array<{ display_name: string }>;
      const names = members.map((m) => m.display_name);
      assert.ok(names.includes("Alice"));
      assert.ok(names.includes("Bob"));
    });

    void test("should filter by admin status", async () => {
      await db.run("UPDATE members SET is_admin = 1 WHERE id = ?", [memberId1]);

      const result = parseResult(
        await server.callTool("list_members", { is_admin: true })
      );
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
      const members = result.members as Array<{ display_name: string; is_admin: boolean }>;
      assert.equal(members[0].display_name, "Alice");
      assert.equal(members[0].is_admin, true);
    });

    void test("should search by name", async () => {
      const result = parseResult(
        await server.callTool("list_members", { query: "ali" })
      );
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
      const members = result.members as Array<{ display_name: string }>;
      assert.equal(members[0].display_name, "Alice");
    });

    void test("should search by email", async () => {
      const result = parseResult(
        await server.callTool("list_members", { query: "bob@" })
      );
      assert.equal(result.success, true);
      assert.equal(result.count, 1);
      const members = result.members as Array<{ display_name: string }>;
      assert.equal(members[0].display_name, "Bob");
    });

    void test("should respect limit and offset", async () => {
      const limited = parseResult(
        await server.callTool("list_members", { limit: 1, offset: 0 })
      );
      assert.equal(limited.count, 1);

      const offset = parseResult(
        await server.callTool("list_members", { limit: 1, offset: 1 })
      );
      assert.equal(offset.count, 1);

      const limitedMembers = limited.members as Array<{ display_name: string }>;
      const offsetMembers = offset.members as Array<{ display_name: string }>;
      assert.notEqual(limitedMembers[0].display_name, offsetMembers[0].display_name);
    });

    void test("should filter members with submissions", async () => {
      // Create a species group and submission for memberId1
      const groupResult = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Fish', 'Testus', 'aqua', 'Fish')`
      );
      const groupId = groupResult.lastID as number;
      const cnResult = await db.run(
        "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
        [groupId, "Test Fish"]
      );
      const commonNameId = cnResult.lastID as number;
      const snResult = await db.run(
        "INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)",
        [groupId, "Testus aqua"]
      );
      const scientificNameId = snResult.lastID as number;
      await db.run(
        `INSERT INTO submissions (member_id, species_class, species_type, species_common_name,
          species_latin_name, common_name_id, scientific_name_id,
          reproduction_date, temperature, ph, gh, specific_gravity, water_type,
          witness_verification_status, program, submitted_on, approved_on, points)
         VALUES (?, 'Fish', 'Fish', 'Test Fish', 'Testus aqua', ?, ?,
           '2024-01-01', '76', '7.0', '8', '1.000', 'Fresh', 'pending', 'fish',
           '2024-01-01', '2024-01-15', 10)`,
        [memberId1, commonNameId, scientificNameId]
      );

      const withSubs = parseResult(
        await server.callTool("list_members", { has_submissions: true })
      );
      assert.equal(withSubs.count, 1);
      const members = withSubs.members as Array<{ display_name: string }>;
      assert.equal(members[0].display_name, "Alice");

      const withoutSubs = parseResult(
        await server.callTool("list_members", { has_submissions: false })
      );
      assert.equal(withoutSubs.count, 1);
      const noSubMembers = withoutSubs.members as Array<{ display_name: string }>;
      assert.equal(noSubMembers[0].display_name, "Bob");
    });

    void test("should not search with query shorter than 2 chars", async () => {
      // Single char query should return all members (not filtered)
      const result = parseResult(
        await server.callTool("list_members", { query: "a" })
      );
      assert.equal(result.success, true);
      // Short query is ignored, returns all
      assert.equal(result.count, 2);
    });
  });

  void describe("get_member_detail", () => {
    void test("should return member details", async () => {
      const result = parseResult(
        await server.callTool("get_member_detail", { member_id: memberId1 })
      );
      assert.equal(result.success, true);
      const member = result.member as Record<string, unknown>;
      assert.equal(member.display_name, "Alice");
      assert.equal(member.contact_email, "alice@test.com");
      assert.equal(member.submission_count, 0);
      assert.equal(member.approved_submission_count, 0);
      assert.equal(member.total_points, 0);
      assert.equal(member.award_count, 0);
      assert.equal(member.tank_preset_count, 0);
      assert.equal(member.has_password, false);
      assert.equal(member.has_google_oauth, false);
    });

    void test("should detect password credentials", async () => {
      // password_account schema: member_id, N, r, p, salt, hash
      await db.run(
        "INSERT INTO password_account (member_id, N, r, p, salt, hash) VALUES (?, ?, ?, ?, ?, ?)",
        [memberId1, 16384, 8, 1, "testsalt", "testhash"]
      );

      const result = parseResult(
        await server.callTool("get_member_detail", { member_id: memberId1 })
      );
      const member = result.member as Record<string, unknown>;
      assert.equal(member.has_password, true);
    });

    void test("should detect google oauth credentials", async () => {
      // google_account schema: google_sub (PK), google_email, member_id
      await db.run(
        "INSERT INTO google_account (google_sub, member_id, google_email) VALUES (?, ?, ?)",
        ["gid123", memberId1, "alice@gmail.com"]
      );

      const result = parseResult(
        await server.callTool("get_member_detail", { member_id: memberId1 })
      );
      const member = result.member as Record<string, unknown>;
      assert.equal(member.has_google_oauth, true);
      assert.equal(member.google_email, "alice@gmail.com");
    });

    void test("should include awards", async () => {
      await db.run(
        "INSERT INTO awards (member_id, award_name) VALUES (?, ?)",
        [memberId1, "Fish Expert"]
      );
      await db.run(
        "INSERT INTO awards (member_id, award_name) VALUES (?, ?)",
        [memberId1, "Cichlid Master"]
      );

      const result = parseResult(
        await server.callTool("get_member_detail", { member_id: memberId1 })
      );
      const member = result.member as Record<string, unknown>;
      assert.equal(member.award_count, 2);
      const awards = member.awards as string[];
      assert.ok(awards.includes("Fish Expert"));
      assert.ok(awards.includes("Cichlid Master"));
    });

    void test("should return error for non-existent member", async () => {
      const result = parseResult(
        await server.callTool("get_member_detail", { member_id: 99999 })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("not found"));
    });
  });

  void describe("update_member", () => {
    void test("should update display_name", async () => {
      const result = parseResult(
        await server.callTool("update_member", {
          member_id: memberId1,
          display_name: "Alicia",
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT display_name FROM members WHERE id = ?",
        [memberId1]
      );
      assert.equal(row.display_name, "Alicia");
    });

    void test("should update contact_email", async () => {
      const result = parseResult(
        await server.callTool("update_member", {
          member_id: memberId1,
          contact_email: "newalice@example.com",
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT contact_email FROM members WHERE id = ?",
        [memberId1]
      );
      assert.equal(row.contact_email, "newalice@example.com");
    });

    void test("should return error when no fields to update", async () => {
      const result = parseResult(
        await server.callTool("update_member", { member_id: memberId1 })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("No fields to update"));
    });
  });

  void describe("set_admin_status", () => {
    void test("should grant admin", async () => {
      const result = parseResult(
        await server.callTool("set_admin_status", {
          member_id: memberId1,
          is_admin: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.is_admin, true);

      const row = await db.get(
        "SELECT is_admin FROM members WHERE id = ?",
        [memberId1]
      );
      assert.equal(row.is_admin, 1);
    });

    void test("should revoke admin", async () => {
      await db.run("UPDATE members SET is_admin = 1 WHERE id = ?", [memberId1]);

      const result = parseResult(
        await server.callTool("set_admin_status", {
          member_id: memberId1,
          is_admin: false,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.is_admin, false);

      const row = await db.get(
        "SELECT is_admin FROM members WHERE id = ?",
        [memberId1]
      );
      assert.equal(row.is_admin, 0);
    });

    void test("should return error for non-existent member", async () => {
      const result = parseResult(
        await server.callTool("set_admin_status", {
          member_id: 99999,
          is_admin: true,
        })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("delete_member", () => {
    void test("should delete member with no submissions", async () => {
      const result = parseResult(
        await server.callTool("delete_member", { member_id: memberId2 })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT * FROM members WHERE id = ?",
        [memberId2]
      );
      assert.equal(row, undefined);
    });

    void test("should fail to delete member with approved submissions without force", async () => {
      const groupResult = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Fish', 'Deletus', 'fish', 'Fish')`
      );
      const groupId = groupResult.lastID as number;
      const cnResult = await db.run(
        "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
        [groupId, "Delete Fish"]
      );
      const scientificNameResult = await db.run(
        "INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)",
        [groupId, "Deletus fish"]
      );
      await db.run(
        `INSERT INTO submissions (member_id, species_class, species_type, species_common_name,
          species_latin_name, common_name_id, scientific_name_id,
          reproduction_date, temperature, ph, gh, specific_gravity, water_type,
          witness_verification_status, program, submitted_on, approved_on, points)
         VALUES (?, 'Fish', 'Fish', 'Delete Fish', 'Deletus fish', ?, ?,
           '2024-01-01', '76', '7.0', '8', '1.000', 'Fresh', 'pending', 'fish',
           '2024-01-01', '2024-01-15', 10)`,
        [memberId1, cnResult.lastID, scientificNameResult.lastID]
      );

      const result = parseResult(
        await server.callTool("delete_member", { member_id: memberId1 })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("approved submissions"));

      const stillExists = await db.get(
        "SELECT id FROM members WHERE id = ?",
        [memberId1]
      );
      assert.ok(stillExists);
    });

    void test("should force delete member with approved submissions", async () => {
      const groupResult = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Fish', 'Deletus', 'forcedel', 'Fish')`
      );
      const groupId = groupResult.lastID as number;
      const cnResult = await db.run(
        "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
        [groupId, "Force Delete Fish"]
      );
      const snResult = await db.run(
        "INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)",
        [groupId, "Deletus forcedel"]
      );
      await db.run(
        `INSERT INTO submissions (member_id, species_class, species_type, species_common_name,
          species_latin_name, common_name_id, scientific_name_id,
          reproduction_date, temperature, ph, gh, specific_gravity, water_type,
          witness_verification_status, program, submitted_on, approved_on, points)
         VALUES (?, 'Fish', 'Fish', 'Force Delete Fish', 'Deletus forcedel', ?, ?,
           '2024-01-01', '76', '7.0', '8', '1.000', 'Fresh', 'pending', 'fish',
           '2024-01-01', '2024-01-15', 10)`,
        [memberId1, cnResult.lastID, snResult.lastID]
      );

      const result = parseResult(
        await server.callTool("delete_member", {
          member_id: memberId1,
          force: true,
        })
      );
      assert.equal(result.success, true);

      const gone = await db.get(
        "SELECT id FROM members WHERE id = ?",
        [memberId1]
      );
      assert.equal(gone, undefined);
    });

    void test("should return error for non-existent member", async () => {
      const result = parseResult(
        await server.callTool("delete_member", { member_id: 99999 })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("merge_members", () => {
    void test("should return preview without making changes", async () => {
      const result = parseResult(
        await server.callTool("merge_members", {
          from_member_id: memberId1,
          to_member_id: memberId2,
          preview: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.preview, true);

      // Members should still exist
      const alice = await db.get("SELECT id FROM members WHERE id = ?", [memberId1]);
      const bob = await db.get("SELECT id FROM members WHERE id = ?", [memberId2]);
      assert.ok(alice);
      assert.ok(bob);
    });

    void test("should merge member data and delete source", async () => {
      const result = parseResult(
        await server.callTool("merge_members", {
          from_member_id: memberId1,
          to_member_id: memberId2,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.from_member_id, memberId1);
      assert.equal(result.to_member_id, memberId2);

      // Source member should be deleted
      const alice = await db.get("SELECT id FROM members WHERE id = ?", [memberId1]);
      assert.equal(alice, undefined);

      // Destination should still exist
      const bob = await db.get("SELECT id FROM members WHERE id = ?", [memberId2]);
      assert.ok(bob);
    });

    void test("should return error when merging member into itself", async () => {
      const result = parseResult(
        await server.callTool("merge_members", {
          from_member_id: memberId1,
          to_member_id: memberId1,
        })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("itself"));
    });

    void test("should return error for non-existent source member", async () => {
      const result = parseResult(
        await server.callTool("merge_members", {
          from_member_id: 99999,
          to_member_id: memberId2,
        })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("list_tools", () => {
    void test("should list all member management tools", async () => {
      const result = await server.listTools();
      const r = result as { tools: Array<{ name: string }> };
      const names = r.tools.map((t) => t.name);
      assert.ok(names.includes("list_members"));
      assert.ok(names.includes("get_member_detail"));
      assert.ok(names.includes("merge_members"));
      assert.ok(names.includes("update_member"));
      assert.ok(names.includes("delete_member"));
      assert.ok(names.includes("set_admin_status"));
    });
  });

  void describe("list_resources", () => {
    void test("should list member resources", async () => {
      const result = await server.listResources();
      const r = result as { resources: Array<{ uri: string }> };
      const uris = r.resources.map((res) => res.uri);
      assert.ok(uris.includes("members://list"));
      assert.ok(uris.includes("members://admins"));
      assert.ok(uris.includes("members://statistics"));
    });
  });

  void describe("read_resource", () => {
    void test("should read members://list", async () => {
      const result = await server.readResource("members://list");
      const r = result as { contents: [{ text: string }] };
      const data = JSON.parse(r.contents[0].text);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
    });

    void test("should read members://admins", async () => {
      await db.run("UPDATE members SET is_admin = 1 WHERE id = ?", [memberId1]);

      const result = await server.readResource("members://admins");
      const r = result as { contents: [{ text: string }] };
      const data = JSON.parse(r.contents[0].text);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 1);
      assert.equal(data[0].display_name, "Alice");
    });

    void test("should read members://statistics", async () => {
      const result = await server.readResource("members://statistics");
      const r = result as { contents: [{ text: string }] };
      const stats = JSON.parse(r.contents[0].text);
      assert.equal(stats.total_members, 2);
      assert.equal(stats.admin_count, 0);
    });

    void test("should read member by ID", async () => {
      const result = await server.readResource(`members://${memberId1}`);
      const r = result as { contents: [{ text: string }] };
      const member = JSON.parse(r.contents[0].text);
      assert.equal(member.display_name, "Alice");
    });

    void test("should throw for unknown resource URI", async () => {
      await assert.rejects(
        async () => await server.readResource("members://unknown"),
        (err: Error) => {
          assert.ok(err.message.includes("Unknown resource URI"));
          return true;
        }
      );
    });

    void test("should throw for unknown member ID", async () => {
      await assert.rejects(
        async () => await server.readResource("members://99999"),
        (err: Error) => {
          assert.ok(err.message.includes("not found"));
          return true;
        }
      );
    });
  });

  void describe("unknown tool", () => {
    void test("should return error for unknown tool name", async () => {
      const result = parseResult(
        await server.callTool("nonexistent_tool", {})
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("Unknown tool"));
    });
  });
});

// ─── Species Server Tests ─────────────────────────────────────────────────────

void describe("species-server-core", () => {
  let server: MockServer;
  let groupId: number;

  beforeEach(async () => {
    await setup();
    server = createMockServer();
    initializeSpeciesServer(server as never);

    // Create a test species group
    const result = await db.run(
      `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type, base_points, is_cares_species)
       VALUES ('Livebearers', 'Testicus', 'speciesus', 'Fish', 10, 0)`
    );
    groupId = result.lastID as number;

    // Add common and scientific names
    await db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      [groupId, "Test Fish"]
    );
    await db.run(
      "INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)",
      [groupId, "Testicus speciesus"]
    );
  });

  afterEach(teardown);

  void describe("create_species_group", () => {
    void test("should create a new species group", async () => {
      const result = parseResult(
        await server.callTool("create_species_group", {
          program_class: "Cichlids",
          canonical_genus: "Newgenus",
          canonical_species_name: "newspecies",
          species_type: "Fish",
          base_points: 15,
        })
      );
      assert.equal(result.success, true);
      assert.ok((result.group_id as number) > 0);

      const row = await db.get(
        "SELECT * FROM species_name_group WHERE group_id = ?",
        [result.group_id]
      );
      assert.equal(row.canonical_genus, "Newgenus");
      assert.equal(row.canonical_species_name, "newspecies");
      assert.equal(row.program_class, "Cichlids");
      assert.equal(row.base_points, 15);
    });

    void test("should create a CARES species", async () => {
      const result = parseResult(
        await server.callTool("create_species_group", {
          program_class: "Killifish",
          canonical_genus: "Caresgenus",
          canonical_species_name: "caresspecies",
          species_type: "Fish",
          is_cares_species: true,
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT is_cares_species FROM species_name_group WHERE group_id = ?",
        [result.group_id]
      );
      assert.equal(row.is_cares_species, 1);
    });

    void test("should return error for invalid species type", async () => {
      const result = parseResult(
        await server.callTool("create_species_group", {
          program_class: "Test",
          canonical_genus: "Genus",
          canonical_species_name: "species",
          species_type: "InvalidType",
        })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("update_species_group", () => {
    void test("should update base_points", async () => {
      const result = parseResult(
        await server.callTool("update_species_group", {
          group_id: groupId,
          base_points: 25,
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.base_points, 25);
    });

    void test("should update is_cares_species", async () => {
      const result = parseResult(
        await server.callTool("update_species_group", {
          group_id: groupId,
          is_cares_species: true,
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT is_cares_species FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.is_cares_species, 1);
    });
  });

  void describe("delete_species_group", () => {
    void test("should delete a species group without submissions", async () => {
      const result = parseResult(
        await server.callTool("delete_species_group", { group_id: groupId })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT group_id FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row, undefined);
    });

    void test("should return error for non-existent group", async () => {
      const result = parseResult(
        await server.callTool("delete_species_group", { group_id: 99999 })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("add_species_synonym", () => {
    void test("should add a synonym to the species group", async () => {
      const result = parseResult(
        await server.callTool("add_species_synonym", {
          group_id: groupId,
          common_name: "Blue Tetra",
          scientific_name: "Testicus bluevariant",
        })
      );
      assert.equal(result.success, true);
      assert.ok((result.name_id as number) > 0);
    });
  });

  void describe("update_species_synonym", () => {
    void test("should update a species synonym", async () => {
      // First add a synonym
      const addResult = parseResult(
        await server.callTool("add_species_synonym", {
          group_id: groupId,
          common_name: "Old Name",
          scientific_name: "Testicus oldname",
        })
      );
      const nameId = addResult.name_id as number;

      const result = parseResult(
        await server.callTool("update_species_synonym", {
          name_id: nameId,
          common_name: "New Name",
        })
      );
      assert.equal(result.success, true);
      assert.ok((result.changes as number) > 0);
    });
  });

  void describe("delete_species_synonym", () => {
    void test("should delete a species synonym", async () => {
      const addResult = parseResult(
        await server.callTool("add_species_synonym", {
          group_id: groupId,
          common_name: "Extra Name",
          scientific_name: "Testicus extra",
        })
      );
      const nameId = addResult.name_id as number;

      const result = parseResult(
        await server.callTool("delete_species_synonym", { name_id: nameId })
      );
      assert.equal(result.success, true);
    });
  });

  void describe("search_species", () => {
    void test("should search by query text", async () => {
      const result = parseResult(
        await server.callTool("search_species", { query: "Testicus" })
      );
      assert.equal(result.success, true);
      const results = result.results as Array<{ canonical_genus: string }>;
      assert.ok(results.some((r) => r.canonical_genus === "Testicus"));
    });

    void test("should filter by species_type", async () => {
      // Add a Plant
      await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Stem Plants', 'Plantus', 'greenus', 'Plant')`
      );

      const fishResult = parseResult(
        await server.callTool("search_species", { species_type: "Fish" })
      );
      const fishResults = fishResult.results as Array<{ species_type: string }>;
      assert.ok(fishResults.every((r) => r.species_type === "Fish"));

      const plantResult = parseResult(
        await server.callTool("search_species", { species_type: "Plant" })
      );
      const plantResults = plantResult.results as Array<{ species_type: string }>;
      assert.ok(plantResults.every((r) => r.species_type === "Plant"));
    });

    void test("should return count_only when requested", async () => {
      const result = parseResult(
        await server.callTool("search_species", { count_only: true })
      );
      assert.equal(result.success, true);
      assert.equal(result.count_only, true);
      assert.ok(typeof result.total_count === "number");
      assert.equal(result.results, undefined);
    });

    void test("should filter by is_cares_species", async () => {
      await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type, is_cares_species)
         VALUES ('Killifish', 'Caresus', 'endangered', 'Fish', 1)`
      );

      const result = parseResult(
        await server.callTool("search_species", { is_cares_species: true })
      );
      const results = result.results as Array<{ is_cares_species: boolean }>;
      assert.ok(results.length > 0);
      assert.ok(results.every((r) => r.is_cares_species === true));
    });
  });

  void describe("get_species_detail", () => {
    void test("should return species detail with synonyms", async () => {
      const result = parseResult(
        await server.callTool("get_species_detail", { group_id: groupId })
      );
      assert.equal(result.success, true);
      const species = result.species as Record<string, unknown>;
      assert.equal(species.canonical_genus, "Testicus");
      assert.equal(species.canonical_species_name, "speciesus");
    });

    void test("should return error for non-existent species", async () => {
      const result = parseResult(
        await server.callTool("get_species_detail", { group_id: 99999 })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("not found"));
    });
  });

  void describe("set_base_points", () => {
    void test("should update base points for single species", async () => {
      const result = parseResult(
        await server.callTool("set_base_points", {
          group_id: groupId,
          base_points: 20,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.updated_count, 1);

      const row = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.base_points, 20);
    });

    void test("should preview without executing changes", async () => {
      const result = parseResult(
        await server.callTool("set_base_points", {
          group_id: groupId,
          base_points: 99,
          preview: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.preview, true);

      // Points should not have changed
      const row = await db.get(
        "SELECT base_points FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.base_points, 10); // Original value
    });

    void test("should update multiple species by IDs", async () => {
      const g2 = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Cichlids', 'Second', 'species', 'Fish')`
      );
      const groupId2 = g2.lastID as number;

      const result = parseResult(
        await server.callTool("set_base_points", {
          group_ids: [groupId, groupId2],
          base_points: 30,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.updated_count, 2);
    });

    void test("should return error without specifying target", async () => {
      const result = parseResult(
        await server.callTool("set_base_points", { base_points: 10 })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("toggle_cares_status", () => {
    void test("should enable CARES status", async () => {
      const result = parseResult(
        await server.callTool("toggle_cares_status", {
          group_id: groupId,
          is_cares_species: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.is_cares_species, true);

      const row = await db.get(
        "SELECT is_cares_species FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.is_cares_species, 1);
    });

    void test("should disable CARES status", async () => {
      await db.run(
        "UPDATE species_name_group SET is_cares_species = 1 WHERE group_id = ?",
        [groupId]
      );

      const result = parseResult(
        await server.callTool("toggle_cares_status", {
          group_id: groupId,
          is_cares_species: false,
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT is_cares_species FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.is_cares_species, 0);
    });
  });

  void describe("merge_species_groups", () => {
    void test("should return preview without changes", async () => {
      const defunct = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Cichlids', 'Defunctus', 'oldname', 'Fish')`
      );
      const defunctId = defunct.lastID as number;

      const result = parseResult(
        await server.callTool("merge_species_groups", {
          canonical_group_id: groupId,
          defunct_group_id: defunctId,
          preview: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.preview, true);

      // Both groups should still exist
      const canonical = await db.get(
        "SELECT group_id FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      const defunctRow = await db.get(
        "SELECT group_id FROM species_name_group WHERE group_id = ?",
        [defunctId]
      );
      assert.ok(canonical);
      assert.ok(defunctRow);
    });

    void test("should merge and delete defunct group", async () => {
      const defunct = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Cichlids', 'Defunctus', 'merged', 'Fish')`
      );
      const defunctId = defunct.lastID as number;
      // Add a name to the defunct group
      await db.run(
        "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
        [defunctId, "Old Common Name"]
      );

      const result = parseResult(
        await server.callTool("merge_species_groups", {
          canonical_group_id: groupId,
          defunct_group_id: defunctId,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.canonical_group_id, groupId);
      assert.equal(result.defunct_group_id, defunctId);

      // Defunct group should be gone
      const gone = await db.get(
        "SELECT group_id FROM species_name_group WHERE group_id = ?",
        [defunctId]
      );
      assert.equal(gone, undefined);
    });

    void test("should return error when merging group with itself", async () => {
      const result = parseResult(
        await server.callTool("merge_species_groups", {
          canonical_group_id: groupId,
          defunct_group_id: groupId,
        })
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("itself"));
    });
  });

  void describe("update_canonical_name", () => {
    void test("should update canonical genus", async () => {
      // Use preserve_old_as_synonym: false to avoid UNIQUE conflict with the
      // scientific name "Testicus speciesus" already in the test setup.
      const result = parseResult(
        await server.callTool("update_canonical_name", {
          group_id: groupId,
          new_canonical_genus: "Renamedus",
          preserve_old_as_synonym: false,
        })
      );
      assert.equal(result.success, true);

      const row = await db.get(
        "SELECT canonical_genus FROM species_name_group WHERE group_id = ?",
        [groupId]
      );
      assert.equal(row.canonical_genus, "Renamedus");
    });

    void test("should preserve old name as synonym by default", async () => {
      // Create a fresh species with no pre-existing scientific name matching
      // its canonical name, so the synonym insert won't conflict.
      const freshResult = await db.run(
        `INSERT INTO species_name_group (program_class, canonical_genus, canonical_species_name, species_type)
         VALUES ('Killifish', 'Killius', 'freshsp', 'Fish')`
      );
      const freshGroupId = freshResult.lastID as number;
      // Add a common name that differs from the canonical name
      await db.run(
        "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
        [freshGroupId, "Killius Fish"]
      );

      await server.callTool("update_canonical_name", {
        group_id: freshGroupId,
        new_canonical_genus: "Renamedkillius",
        preserve_old_as_synonym: true,
      });

      // Old canonical name "Killius freshsp" should now be in common names
      const commonName = await db.get(
        "SELECT common_name FROM species_common_name WHERE group_id = ? AND common_name = ?",
        [freshGroupId, "Killius freshsp"]
      );
      assert.ok(commonName);
    });

    void test("should return error without new name fields", async () => {
      const result = parseResult(
        await server.callTool("update_canonical_name", { group_id: groupId })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("list_common_names_by_text", () => {
    void test("should find common names by exact text", async () => {
      const result = parseResult(
        await server.callTool("list_common_names_by_text", {
          common_name: "Test Fish",
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.common_name, "Test Fish");
      assert.ok((result.count as number) >= 1);
    });

    void test("should return empty for non-existent name", async () => {
      const result = parseResult(
        await server.callTool("list_common_names_by_text", {
          common_name: "Nonexistent Fish",
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.count, 0);
    });
  });

  void describe("bulk_delete_common_names", () => {
    void test("should preview deletion by common_name text", async () => {
      const result = parseResult(
        await server.callTool("bulk_delete_common_names", {
          common_name: "Test Fish",
          preview: true,
        })
      );
      assert.equal(result.success, true);
      assert.equal(result.preview, true);
      assert.ok((result.count as number) >= 1);

      // Should not have deleted anything
      const stillExists = await db.get(
        "SELECT common_name_id FROM species_common_name WHERE common_name = ?",
        ["Test Fish"]
      );
      assert.ok(stillExists);
    });

    void test("should return error without common_name or ids", async () => {
      const result = parseResult(
        await server.callTool("bulk_delete_common_names", {})
      );
      assert.equal(result.success, false);
    });

    void test("should return error with both common_name and ids", async () => {
      const cn = await db.get(
        "SELECT common_name_id FROM species_common_name WHERE group_id = ?",
        [groupId]
      );
      const result = parseResult(
        await server.callTool("bulk_delete_common_names", {
          common_name: "Test Fish",
          common_name_ids: [cn.common_name_id],
        })
      );
      assert.equal(result.success, false);
    });
  });

  void describe("list_tools", () => {
    void test("should list all species management tools", async () => {
      const result = await server.listTools();
      const r = result as { tools: Array<{ name: string }> };
      const names = r.tools.map((t) => t.name);
      assert.ok(names.includes("create_species_group"));
      assert.ok(names.includes("update_species_group"));
      assert.ok(names.includes("delete_species_group"));
      assert.ok(names.includes("add_species_synonym"));
      assert.ok(names.includes("search_species"));
      assert.ok(names.includes("get_species_detail"));
      assert.ok(names.includes("merge_species_groups"));
      assert.ok(names.includes("set_base_points"));
      assert.ok(names.includes("toggle_cares_status"));
    });
  });

  void describe("list_resources", () => {
    void test("should list species resources", async () => {
      const result = await server.listResources();
      const r = result as { resources: Array<{ uri: string }> };
      const uris = r.resources.map((res) => res.uri);
      assert.ok(uris.includes("species://groups/list"));
      assert.ok(uris.includes("species://groups/cares"));
      assert.ok(uris.includes("species://statistics"));
    });
  });

  void describe("read_resource", () => {
    void test("should read species://groups/list", async () => {
      const result = await server.readResource("species://groups/list");
      const r = result as { contents: [{ text: string }] };
      const data = JSON.parse(r.contents[0].text);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
    });

    void test("should read species://statistics", async () => {
      const result = await server.readResource("species://statistics");
      const r = result as { contents: [{ text: string }] };
      const stats = JSON.parse(r.contents[0].text);
      assert.ok(typeof stats.total_species === "number");
      assert.ok(stats.total_species >= 1);
    });

    void test("should read species://groups/by-type/Fish", async () => {
      const result = await server.readResource("species://groups/by-type/Fish");
      const r = result as { contents: [{ text: string }] };
      const data = JSON.parse(r.contents[0].text);
      assert.ok(Array.isArray(data));
      assert.ok(data.every((s: { species_type: string }) => s.species_type === "Fish"));
    });

    void test("should read species://groups/cares", async () => {
      await db.run(
        "UPDATE species_name_group SET is_cares_species = 1 WHERE group_id = ?",
        [groupId]
      );
      const result = await server.readResource("species://groups/cares");
      const r = result as { contents: [{ text: string }] };
      const data = JSON.parse(r.contents[0].text);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
    });

    void test("should read species group by ID", async () => {
      const result = await server.readResource(`species://groups/${groupId}`);
      const r = result as { contents: [{ text: string }] };
      const group = JSON.parse(r.contents[0].text);
      assert.equal(group.canonical_genus, "Testicus");
      assert.ok(Array.isArray(group.synonyms));
    });

    void test("should throw for unknown resource URI", async () => {
      await assert.rejects(
        async () => await server.readResource("species://unknown"),
        (err: Error) => {
          assert.ok(err.message.includes("Unknown resource URI"));
          return true;
        }
      );
    });
  });

  void describe("unknown tool", () => {
    void test("should return error for unknown tool name", async () => {
      const result = parseResult(
        await server.callTool("nonexistent_tool", {})
      );
      assert.equal(result.success, false);
      assert.ok((result.error as string).includes("Unknown tool"));
    });
  });
});

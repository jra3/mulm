import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSpeciesServer } from "@/mcp/species-server-core";
import { initializeMemberServer } from "@/mcp/member-server-core";
import { initializeBackfillServer } from "@/mcp/backfill-server-core";
import { createMember } from "@/db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

const initializers = {
  species: initializeSpeciesServer,
  members: initializeMemberServer,
  backfill: initializeBackfillServer,
};

const payloadSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  isError: z.boolean().optional(),
});
function payload(result: unknown): Record<string, unknown> {
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(payloadSchema.parse(result).content[0].text));
}

void describe("MCP contracts over real in-memory client/server transports", () => {
  let database: TestDatabase;
  const sessions: Array<{ client: Client; server: Server }> = [];
  beforeEach(async () => {
    database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
  });
  afterEach(async () => {
    for (const { client, server } of sessions.splice(0)) {
      await client.close();
      await server.close();
    }
    await database.cleanup();
  });
  async function connect(area: keyof typeof initializers) {
    const server = new Server(
      { name: area, version: "test" },
      { capabilities: { tools: {}, resources: {} } }
    );
    initializers[area](server);
    const client = new Client({ name: "test", version: "test" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    sessions.push({ client, server });
    return client;
  }

  void test("discovery advertises every tool and enforces each required field and property type", async () => {
    for (const [area, count] of [
      ["species", 22],
      ["members", 6],
      ["backfill", 6],
    ] as const) {
      const client = await connect(area);
      const { tools } = await client.listTools();
      assert.equal(tools.length, count);
      for (const tool of tools) {
        assert.equal(tool.inputSchema.type, "object");
        // An invalid property is sent even for optional-only tools. Intersection
        // schemas expose object fields through allOf or distributed anyOf branches.
        const object = z
          .object({
            properties: z.record(z.string(), z.unknown()).optional(),
            required: z.array(z.string()).optional(),
            allOf: z.array(z.unknown()).optional(),
            anyOf: z.array(z.unknown()).optional(),
          })
          .parse(tool.inputSchema);
        const shape = object.properties
          ? object
          : z
              .object({
                properties: z.record(z.string(), z.unknown()),
                required: z.array(z.string()).optional(),
              })
              .parse(object.allOf?.[0] ?? object.anyOf?.[0]);
        const first = Object.keys(shape.properties ?? {})[0];
        if (first) {
          const result = await client.callTool({
            name: tool.name,
            arguments: { [first]: { invalid: true } },
          });
          assert.equal(payloadSchema.parse(result).isError, true, tool.name);
          assert.equal(payload(result).error_code, "INVALID_ARGUMENTS", tool.name);
        }
        if (shape.required?.length) {
          const result = await client.callTool({ name: tool.name });
          assert.equal(
            payload(result).error_code,
            "INVALID_ARGUMENTS",
            `${tool.name} requires fields`
          );
        }
      }
    }
    assert.equal((await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM members"))?.n, 0);
    assert.equal(
      (await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions"))?.n,
      0
    );
  });

  void test("invalid ids, ranges, lists, overrides and incompatible selectors fail deterministically before effects", async () => {
    const species = await connect("species");
    const members = await connect("members");
    const backfill = await connect("backfill");
    const cases: Array<[Client, string, Record<string, unknown>]> = [
      [members, "delete_member", { member_id: 0, force: true }],
      [members, "set_admin_status", { member_id: 1.5, is_admin: true }],
      [members, "merge_members", { from_member_id: "1", to_member_id: 2 }],
      [members, "list_members", { offset: -1 }],
      [members, "update_member", { member_id: 1 }],
      [species, "search_species", { limit: 1.5 }],
      [species, "update_species_group", { group_id: 1, image_links: [4] }],
      [species, "set_base_points", { base_points: 5, group_ids: [1, "2"] }],
      [species, "set_base_points", { base_points: 5, group_ids: [] }],
      [species, "set_base_points", { base_points: 5, group_id: 1, group_ids: [2] }],
      [species, "set_base_points", { base_points: 5, group_id: 1, species_type: "Fish" }],
      [species, "bulk_remove_names", { kind: "common", text: "name", name_ids: [1] }],
      [species, "sync_iucn_data", { group_id: 1, sync_missing: true }],
      [species, "sync_iucn_data", { days_old: -1 }],
      [species, "update_canonical_name", { group_id: 1 }],
      [
        backfill,
        "import_submissions",
        { file_path: "/must-not-be-read.csv", member_id: 1, admin_id: 2, skip_rows: [-1] },
      ],
      [
        backfill,
        "import_submissions",
        {
          file_path: "/must-not-be-read.csv",
          member_id: 1,
          admin_id: 2,
          species_overrides: { "0": { group_id: "1" } },
        },
      ],
      [
        backfill,
        "import_submissions",
        {
          file_path: "/must-not-be-read.csv",
          member_id: 1,
          admin_id: 2,
          date_overrides: { "-1": "2024-02-02" },
        },
      ],
      [
        backfill,
        "import_submissions",
        {
          file_path: "/must-not-be-read.csv",
          member_id: 1,
          admin_id: 2,
          date_overrides: { "0": "2024-02-30" },
        },
      ],
    ];
    for (const [client, name, args] of cases) {
      const first = await client.callTool({ name, arguments: args });
      assert.equal(payload(first).error_code, "INVALID_ARGUMENTS", name);
      assert.deepEqual(await client.callTool({ name, arguments: args }), first, name);
    }
  });

  void test("valid calls preserve defaults, catalogue operations, member merge and resource payloads", async () => {
    const species = await connect("species");
    const created = payload(
      await species.callTool({
        name: "create_species_group",
        arguments: {
          canonical_genus: "Poecilia",
          canonical_species_name: "reticulata",
          species_type: "Fish",
          program_class: "Livebearers",
          base_points: 5,
        },
      })
    );
    assert.equal(created.success, true);
    const groupId = z.number().parse(created.group_id);
    assert.equal(payload(await species.callTool({ name: "search_species" })).returned_count, 100);
    assert.equal(
      payload(
        await species.callTool({
          name: "update_species_group",
          arguments: { group_id: groupId, base_points: null },
        })
      ).success,
      true
    );
    const resource = await species.readResource({ uri: `species://groups/${groupId}` });
    const body = z.object({ text: z.string() }).parse(resource.contents[0]);
    assert.equal(JSON.parse(body.text).base_points, null);
    for (const name of [
      "get_iucn_sync_log",
      "get_species_missing_iucn",
      "get_species_needing_resync",
      "get_iucn_sync_stats",
      "get_canonical_recommendations",
    ]) {
      assert.equal(payload(await species.callTool({ name })).success, true, name);
    }
    const keeper = await createMember("keep@example.com", "Keep");
    const duplicate = await createMember("duplicate@example.com", "Duplicate", {
      google_sub: "duplicate-google",
    });
    const members = await connect("members");
    assert.equal(payload(await members.callTool({ name: "list_members" })).success, true);
    const preview = payload(
      await members.callTool({
        name: "merge_members",
        arguments: { from_member_id: duplicate, to_member_id: keeper, preview: true },
      })
    );
    assert.equal(preview.preview, true);
    const merged = payload(
      await members.callTool({
        name: "merge_members",
        arguments: { from_member_id: duplicate, to_member_id: keeper },
      })
    );
    assert.equal(merged.success, true);
    assert.equal(merged.to_member_id, keeper);
    assert.equal(
      (
        await database.db.get<{ member_id: number }>(
          "SELECT member_id FROM google_account WHERE google_sub = ?",
          "duplicate-google"
        )
      )?.member_id,
      keeper
    );
    assert.ok(
      (await members.listResources()).resources.some((r) => r.uri === "members://statistics")
    );
    const backfill = await connect("backfill");
    assert.equal(
      payload(
        await backfill.callTool({ name: "search_member_for_import", arguments: { name: "Keep" } })
      ).success,
      true
    );
    assert.equal(
      payload(
        await backfill.callTool({
          name: "search_species_for_import",
          arguments: { query: "Poecilia" },
        })
      ).success,
      true
    );
    assert.equal(
      (await backfill.readResource({ uri: "backfill://statistics" })).contents.length,
      1
    );
  });

  void test("backfill file adapters preserve parse/validation/import reports and default execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mulm-mcp-"));
    try {
      const filePath = join(directory, "legacy.csv");
      await writeFile(
        filePath,
        "species_common_name,species_class,foods,spawn_locations,reproduction_date\nLegacy,Livebearers,Flake,Plants,Mid April 2024\n"
      );
      const memberId = await createMember("historical@example.com", "Historical");
      const adminId = await createMember("admin@example.com", "Admin");
      await database.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", adminId);
      const client = await connect("backfill");
      const parsed = payload(
        await client.callTool({
          name: "parse_csv",
          arguments: { file_path: filePath, preview_limit: 0 },
        })
      );
      assert.equal(parsed.total_rows, 1);
      assert.equal(parsed.displayed_rows, 1);
      assert.equal(parsed.file_path, filePath);
      const validated = payload(
        await client.callTool({
          name: "validate_import",
          arguments: {
            file_path: filePath,
            member_id: memberId,
            admin_id: adminId,
            default_points: 7,
          },
        })
      );
      assert.equal(validated.file_path, filePath);
      assert.equal(validated.total_rows, 1);
      const imported = payload(
        await client.callTool({
          name: "import_submissions",
          arguments: {
            file_path: filePath,
            member_id: memberId,
            admin_id: adminId,
            default_points: 7,
          },
        })
      );
      assert.equal(imported.success, true);
      assert.equal(imported.dry_run, false);
      assert.equal(imported.inserted_count, 1);
      assert.equal(imported.total_points, 7);
      assert.equal(
        (await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions"))?.n,
        1
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

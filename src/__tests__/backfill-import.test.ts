import { beforeEach, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { createMember } from "@/db/members";
import { createSpecies } from "@/species";
import { importHistoricalRows, validateHistoricalRows } from "@/backfill/import";

void describe("historical backfill domain operations", () => {
  let database: TestDatabase;
  let memberId: number;
  let adminId: number;
  let speciesId: number;
  beforeEach(async () => {
    database = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("member@example.com", "Historical Member");
    adminId = await createMember("admin@example.com", "Admin");
    await database.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", adminId);
    speciesId = await createSpecies({
      canonicalGenus: "Backfillus",
      canonicalSpeciesName: "testus",
      programClass: "Livebearers",
      speciesType: "Fish",
      pointClass: 10,
    });
  });
  afterEach(async () => {
    await database.cleanup();
  });

  void test("validation resolves catalogue names and historical date/list conventions", async () => {
    const result = await validateHistoricalRows(
      [
        {
          member_name: "Historical Member",
          species_latin_name: "Backfillus testus",
          reproduction_date: "Mid April 2024",
          water_type: "freshwater",
          foods: "Custom food",
        },
      ],
      { admin_id: adminId, default_points: 7 }
    );
    assert.equal(result.ready_count, 1);
    assert.equal(result.validations[0].normalized.member_id, memberId);
    assert.equal(result.validations[0].normalized.species_id, speciesId);
    assert.equal(result.validations[0].normalized.points, 10);
    assert.equal(result.validations[0].normalized.reproduction_date, "2024-04-15");
    assert.equal(result.validations[0].normalized.foods, '["Custom food"]');
  });

  void test("imports already-approved history, accepts unbound legacy rows and preserves per-row errors", async () => {
    const result = await importHistoricalRows(
      [
        {
          species_common_name: "Uncatalogued legacy fish",
          species_class: "Livebearers",
          foods: "Flake",
          spawn_locations: "Plants",
          reproduction_date: "June/July 2024",
          fertilizers: "Iron;Potassium",
        },
        {
          species_latin_name: "Backfillus testus",
          foods: "Flake",
          spawn_locations: "Plants",
          reproduction_date: "unknown",
        },
        { species_type: "Dragon" },
        { species_common_name: "Skipped" },
        { species_common_name: "Missing override" },
      ],
      {
        member_id: memberId,
        admin_id: adminId,
        default_points: 7,
        skip_rows: [3],
        date_overrides: { "1": "2024-03-01" },
        species_overrides: { "4": { group_id: 999999 } },
      }
    );
    assert.equal(result.inserted_count, 2, JSON.stringify(result));
    assert.equal(result.skipped_count, 1);
    assert.equal(result.error_count, 2);
    assert.equal(result.total_points, 17);
    const records = await database.db.all<
      Array<{
        species_id: number | null;
        points: number;
        approved_by: number;
        approved_on: string;
        witnessed_by: number;
        witness_verification_status: string;
        reproduction_date: string;
        submitted_on: string;
      }>
    >("SELECT * FROM submissions ORDER BY id");
    assert.equal(records[0].species_id, null);
    assert.equal(records[0].points, 7); // Historical totals are not restricted to today's Point classes.
    assert.equal(records[0].reproduction_date, "2024-06-15");
    assert.equal(records[0].submitted_on, "2024-06-15");
    assert.equal(records[0].approved_by, adminId);
    assert.ok(records[0].approved_on);
    assert.equal(records[0].witnessed_by, adminId);
    assert.equal(records[0].witness_verification_status, "confirmed");
    assert.equal(records[1].species_id, speciesId);
    assert.equal(records[1].reproduction_date, "2024-03-01");
    assert.equal(
      (await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission_supplements"))?.n,
      2
    );
  });

  void test("dry runs roll back submissions and supplements while retaining the report", async () => {
    const result = await importHistoricalRows(
      [
        {
          species_common_name: "Legacy",
          species_class: "Livebearers",
          foods: "Flake",
          spawn_locations: "Plants",
          fertilizers: "Iron",
        },
      ],
      { member_id: memberId, admin_id: adminId, default_points: 5, dry_run: true }
    );
    assert.equal(result.dry_run, true);
    assert.equal(result.inserted_count, 1, JSON.stringify(result));
    assert.equal(
      (await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submissions"))?.n,
      0
    );
    assert.equal(
      (await database.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM submission_supplements"))?.n,
      0
    );
  });

  void test("an import requires an existing member and an administrator", async () => {
    await assert.rejects(
      importHistoricalRows([], { member_id: 999999, admin_id: adminId }),
      /Member 999999 not found/
    );
    await assert.rejects(
      importHistoricalRows([], { member_id: memberId, admin_id: memberId }),
      /not an admin/
    );
  });
});

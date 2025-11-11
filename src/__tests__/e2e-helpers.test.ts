import { describe, test, before, after } from "node:test";
import assert from "node:assert";
import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

/**
 * Unit tests for E2E test helpers
 *
 * These tests verify that E2E test helpers work correctly with the current
 * database schema. This catches schema mismatches (like missing columns) at
 * unit test time instead of waiting for slow E2E tests to fail.
 */

let db: Database;
let testDbPath: string;

before(async () => {
  // Create temporary test database
  testDbPath = path.join(__dirname, "../../db/e2e-helpers-test.db");

  // Remove if exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  db = await open({
    filename: testDbPath,
    driver: sqlite3.Database,
  });

  // Run migrations to get current schema
  await db.migrate({
    migrationsPath: path.join(__dirname, "../../db/migrations"),
  });
});

after(async () => {
  if (db) {
    await db.close();
  }
  if (testDbPath && fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

void describe("E2E Test Helpers", () => {

  void describe("createTestSubmission (Fish)", () => {
    void test("should create a Fish submission with current schema", async () => {
      // Create a test member
      const memberResult = await db.run(
        `INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)`,
        "Test User", "test@example.com", 0
      );
      const memberId = memberResult.lastID as number;

      // Create a Fish submission using the same pattern as E2E helper
      const result = await db.run(
        `INSERT INTO submissions (
          member_id,
          program,
          species_type,
          species_class,
          species_common_name,
          species_latin_name,
          water_type,
          count,
          reproduction_date,
          foods,
          spawn_locations,
          propagation_method,
          light_type,
          light_strength,
          light_hours,
          co2,
          co2_description,
          tank_size,
          filter_type,
          water_change_volume,
          water_change_frequency,
          temperature,
          ph,
          gh,
          substrate_type,
          substrate_depth,
          substrate_color,
          submitted_on,
          witness_verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        memberId,
        "fish",
        "Fish",
        "Livebearers",
        "Guppy",
        "Poecilia reticulata",
        "Fresh",
        "25",
        new Date().toISOString(),
        JSON.stringify(["Live", "Flake"]),
        JSON.stringify(["Floating plants"]),
        null, // No propagation for fish
        null, // No lighting for fish
        null,
        null,
        null, // No co2 for fish
        null,
        "10 gallon",
        "Sponge",
        "25%",
        "Weekly",
        "75",
        "7.0",
        "150",
        "Gravel",
        "1 inch",
        "Natural",
        new Date().toISOString(),
        "pending"
      );

      assert.ok(result.lastID, "Should create submission");

      // Verify it was created
      const submission = await db.get("SELECT * FROM submissions WHERE id = ?", result.lastID);
      assert.strictEqual(submission.species_type, "Fish");
      assert.strictEqual(submission.program, "fish");
      assert.strictEqual(submission.count, "25");
      assert.strictEqual(submission.propagation_method, null);
    });
  });

  void describe("createTestSubmission (Plant)", () => {
    void test("should create a Plant submission with current schema", async () => {
      const memberResult = await db.run(
        `INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)`,
        "Test Plant User", "plant@example.com", 0
      );
      const memberId = memberResult.lastID as number;

      // Create a Plant submission
      const result = await db.run(
        `INSERT INTO submissions (
          member_id,
          program,
          species_type,
          species_class,
          species_common_name,
          species_latin_name,
          water_type,
          count,
          reproduction_date,
          foods,
          spawn_locations,
          propagation_method,
          light_type,
          light_strength,
          light_hours,
          co2,
          co2_description,
          tank_size,
          filter_type,
          water_change_volume,
          water_change_frequency,
          temperature,
          ph,
          gh,
          substrate_type,
          substrate_depth,
          substrate_color,
          submitted_on,
          witness_verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        memberId,
        "plant",
        "Plant",
        "Cryptocoryne",
        "Wendt's Cryptocoryne",
        "Cryptocoryne wendtii",
        "Fresh",
        null, // No count for plants
        new Date().toISOString(),
        "[]", // No foods for plants (but column has NOT NULL constraint)
        "[]", // No spawn locations for plants (but column has NOT NULL constraint)
        "Cuttings", // Plant has propagation
        "LED", // Plant has lighting
        "200W",
        "16",
        "no", // Plant can have co2
        null,
        "10 gallon",
        "Sponge",
        "25%",
        "Weekly",
        "75",
        "7.0",
        "150",
        "Gravel",
        "1 inch",
        "Natural",
        new Date().toISOString(),
        "pending"
      );

      assert.ok(result.lastID, "Should create submission");

      const submission = await db.get("SELECT * FROM submissions WHERE id = ?", result.lastID);
      assert.strictEqual(submission.species_type, "Plant");
      assert.strictEqual(submission.program, "plant");
      assert.strictEqual(submission.propagation_method, "Cuttings");
      assert.strictEqual(submission.light_type, "LED");
      assert.strictEqual(submission.count, null);
      assert.strictEqual(submission.foods, "[]"); // Column has NOT NULL DEFAULT '[]'
    });
  });

  void describe("createTestSubmission (Coral)", () => {
    void test("should create a Coral submission with current schema", async () => {
      const memberResult = await db.run(
        `INSERT INTO members (display_name, contact_email, is_admin) VALUES (?, ?, ?)`,
        "Test Coral User", "coral@example.com", 0
      );
      const memberId = memberResult.lastID as number;

      // Create a Coral submission
      const result = await db.run(
        `INSERT INTO submissions (
          member_id,
          program,
          species_type,
          species_class,
          species_common_name,
          species_latin_name,
          water_type,
          count,
          reproduction_date,
          foods,
          spawn_locations,
          propagation_method,
          light_type,
          light_strength,
          light_hours,
          co2,
          co2_description,
          tank_size,
          filter_type,
          water_change_volume,
          water_change_frequency,
          temperature,
          ph,
          gh,
          substrate_type,
          substrate_depth,
          substrate_color,
          submitted_on,
          witness_verification_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        memberId,
        "coral",
        "Coral",
        "Hard",
        "Staghorn Coral",
        "Acropora millepora",
        "Salt",
        null, // No count for corals
        new Date().toISOString(),
        JSON.stringify(["Live", "Reef Roids"]), // Coral has foods
        "[]", // No spawn locations for corals (but column has NOT NULL constraint)
        "Fragmentation", // Coral has propagation
        "LED", // Coral has lighting
        "200W",
        "16",
        "no", // Coral can have co2
        null,
        "10 gallon",
        "Sponge",
        "25%",
        "Weekly",
        "75",
        "7.0",
        "150",
        "Rock",
        "1 inch",
        "Natural",
        new Date().toISOString(),
        "pending"
      );

      assert.ok(result.lastID, "Should create submission");

      const submission = await db.get("SELECT * FROM submissions WHERE id = ?", result.lastID);
      assert.strictEqual(submission.species_type, "Coral");
      assert.strictEqual(submission.program, "coral");
      assert.strictEqual(submission.propagation_method, "Fragmentation");
      assert.strictEqual(submission.light_type, "LED");
      assert.strictEqual(submission.count, null);
      assert.strictEqual(submission.foods, JSON.stringify(["Live", "Reef Roids"]));
    });
  });

  void describe("Schema Compatibility", () => {
    void test("submissions table should NOT have supplement_type column", async () => {
      // This test ensures migration 044 has been applied (old columns dropped)
      const tableInfo = await db.all<Array<{ name: string }>>("PRAGMA table_info(submissions)");
      const columnNames = tableInfo.map((col) => col.name);

      assert.ok(!columnNames.includes("supplement_type"), "supplement_type should be removed");
      assert.ok(!columnNames.includes("supplement_regimen"), "supplement_regimen should be removed");
      assert.ok(!columnNames.includes("images"), "images should be removed");
    });

    void test("submissions table should have all expected columns", async () => {
      const tableInfo = await db.all<Array<{ name: string }>>("PRAGMA table_info(submissions)");
      const columnNames = tableInfo.map((col) => col.name);

      // Verify key columns exist
      const expectedColumns = [
        "id",
        "member_id",
        "program",
        "species_type",
        "species_class",
        "propagation_method",
        "light_type",
        "light_strength",
        "light_hours",
        "co2",
        "co2_description",
        "foods",
        "spawn_locations",
        "submitted_on",
        "witness_verification_status",
      ];

      for (const col of expectedColumns) {
        assert.ok(columnNames.includes(col), `Column ${col} should exist`);
      }
    });

    void test("normalized tables should exist for supplements and images", async () => {
      // Check that new normalized tables exist
      const tables = await db.all<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      const tableNames = tables.map((t) => t.name);

      assert.ok(tableNames.includes("submission_supplements"), "submission_supplements table should exist");
      assert.ok(tableNames.includes("submission_images"), "submission_images table should exist");
    });
  });
});

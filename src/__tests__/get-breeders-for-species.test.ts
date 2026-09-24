/**
 * getBreedersForSpecies: the members with approved Submissions bound to a
 * Species, through the Submission's species_id.
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import {
  getBreedersForSpecies,
  createSpecies,
} from "@/species";

void describe("getBreedersForSpecies", () => {
  let db: Database;
  let testGroupId: number;
  let member1Id: number;
  let member2Id: number;

  beforeEach(async () => {
    db = await open({
      filename: ":memory:",
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);

    // Create test species group
    testGroupId = await createSpecies({
      programClass: "Test Class",
      speciesType: "Fish",
      canonicalGenus: "Breederus",
      canonicalSpeciesName: "testicus",
      pointClass: 10,
    });

    // Create test members
    const member1 = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES ('Test Breeder 1', 'breeder1@test.com', 0)
    `);
    member1Id = member1.lastID as number;

    const member2 = await db.run(`
      INSERT INTO members (display_name, contact_email, is_admin)
      VALUES ('Test Breeder 2', 'breeder2@test.com', 0)
    `);
    member2Id = member2.lastID as number;
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  void describe("Bound Submissions", () => {
    void test("should find breeders of a bound Submission", async () => {

      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Common Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].member_id, member1Id);
      assert.strictEqual(breeders[0].breed_count, 1);
    });
  });

  void describe("A second bound Submission", () => {
    void test("should find breeders whatever spelling the member used", async () => {

      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].member_id, member1Id);
      assert.strictEqual(breeders[0].breed_count, 1);
    });
  });

  void describe("Several breeders", () => {
    void test("should find each breeder of the Species", async () => {

      // Member 1: common_name submission
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Common Name', 'Breederus testicus', datetime('now', '-15 days'), 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      // Member 2: scientific_name submission
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Scientific Name', datetime('now'), 10, 'fish')
      `,
        [member2Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 2, "Should find both breeders");

      const breeder1 = breeders.find((b) => b.member_id === member1Id);
      const breeder2 = breeders.find((b) => b.member_id === member2Id);

      assert.ok(breeder1 && breeder2, "Both breeders should be found");
      assert.strictEqual(breeder1.breed_count, 1, "Member 1 should have 1 breed");
      assert.strictEqual(breeder2.breed_count, 1, "Member 2 should have 1 breed");
    });
  });

  void describe("Filtering and aggregation", () => {
    void test("should only count approved submissions", async () => {

      // Approved submission
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      // Draft submission (not approved)
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          submitted_on, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', NULL, 'fish')
      `,
        [member1Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      assert.strictEqual(breeders[0].breed_count, 1, "Should only count approved submission");
    });

    void test("should return empty array for species with no breeds", async () => {
      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 0);
    });

    void test("should sort by breed_count DESC", async () => {

      // Member 1: 1 breed
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      // Member 2: 2 breeds
      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES
          (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', datetime('now', '-10 days'), 10, 'fish'),
          (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', datetime('now'), 10, 'fish')
      `,
        [member2Id, testGroupId, member2Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(
        breeders[0].member_id,
        member2Id,
        "Member with more breeds should be first"
      );
      assert.strictEqual(breeders[0].breed_count, 2);
      assert.strictEqual(breeders[1].member_id, member1Id);
      assert.strictEqual(breeders[1].breed_count, 1);
    });
  });

  void describe("Return value structure", () => {
    void test("should include all required fields", async () => {

      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', '2025-01-15', 10, 'fish')
      `,
        [member1Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders.length, 1);
      const breeder = breeders[0];

      assert.ok("member_id" in breeder);
      assert.ok("member_name" in breeder);
      assert.ok("breed_count" in breeder);
      assert.ok("first_breed_date" in breeder);
      assert.ok("latest_breed_date" in breeder);
      assert.ok("submissions" in breeder);

      assert.strictEqual(typeof breeder.member_id, "number");
      assert.strictEqual(typeof breeder.member_name, "string");
      assert.strictEqual(typeof breeder.breed_count, "number");
      assert.ok(Array.isArray(breeder.submissions));
    });

    void test("should parse submissions array correctly", async () => {

      const submissionResult = await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', '2025-01-15', 10, 'fish')
      `,
        [member1Id, testGroupId]
      );
      const submissionId = submissionResult.lastID as number;

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders[0].submissions.length, 1);
      const sub = breeders[0].submissions[0];

      assert.strictEqual(sub.id, submissionId);
      assert.strictEqual(sub.species_common_name, "Test Fish");
      assert.strictEqual(sub.species_latin_name, "Breederus testicus");
      assert.strictEqual(sub.approved_on, "2025-01-15");
      assert.strictEqual(sub.points, 10);
    });
  });

  void describe("Date tracking", () => {
    void test("should track first and latest breed dates correctly", async () => {

      await db.run(
        `
        INSERT INTO submissions (
          member_id, species_id, species_type, species_class,
          species_common_name, species_latin_name,
          approved_on, points, program
        ) VALUES
          (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', '2025-01-01', 10, 'fish'),
          (?, ?, 'Fish', 'Test Class', 'Test Fish', 'Breederus testicus', '2025-06-15', 10, 'fish')
      `,
        [member1Id, testGroupId, member1Id, testGroupId]
      );

      const breeders = await getBreedersForSpecies(testGroupId);

      assert.strictEqual(breeders[0].first_breed_date, "2025-01-01");
      assert.strictEqual(breeders[0].latest_breed_date, "2025-06-15");
    });
  });
});

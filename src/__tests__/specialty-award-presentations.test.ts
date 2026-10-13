import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { open, type Database } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "@/db/conn";
import { getSpecialtyAwardProgress as publicProgress, grantAward } from "@/db/members";
import { getSpecialtyAwardProgress as accountProgress } from "@/specialtyAwardManager";

void describe("Specialty Award page presentation contracts", () => {
  let db: Database;
  let memberId: number;

  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
    const member = await db.run(
      "INSERT INTO members (display_name, contact_email) VALUES ('Progress', 'progress@example.com')"
    );
    memberId = member.lastID!;
  });
  afterEach(async () => {
    await db.close();
  });

  async function submissions(speciesClass: string, count: number) {
    for (let i = 0; i < count; i++) {
      await db.run(
        `INSERT INTO submissions (member_id, program, species_type, species_class,
          species_common_name, species_latin_name, water_type, submitted_on, approved_on)
         VALUES (?, 'fish', 'Fish', ?, 'Test fish', ?, 'Fresh', '2026-01-01', '2026-03-01')`,
        [memberId, speciesClass, `${speciesClass} species${i}`]
      );
    }
  }

  void test("account caps progress and requires grants; public exposes qualification above 100%", async () => {
    await submissions("Anabantoids", 7);
    const account = (await accountProgress(memberId)).specialtyProgress[0];
    const profile = (await publicProgress(memberId)).awards[0];
    assert.equal(account.currentSpecies, 7);
    assert.equal(account.percentage, 100);
    assert.equal(account.isCompleted, false);
    assert.equal(profile.percentComplete, 117);
    assert.equal(profile.isComplete, true);
    assert.equal(profile.isGranted, false);
    await grantAward(memberId, "Anabantoids Specialist", new Date(), "species");
    assert.equal((await accountProgress(memberId)).specialtyProgress[0].isCompleted, true);
  });

  void test("account defers limitation failure until threshold; public displays it immediately", async () => {
    await submissions("Catfish & Loaches", 4);
    const account = (await accountProgress(memberId)).specialtyProgress.find(
      (a) => a.name === "Catfish Specialist"
    )!;
    const profile = (await publicProgress(memberId)).awards.find(
      (a) => a.awardName === "Catfish Specialist"
    )!;
    assert.equal(account.isLimitationMet, true);
    assert.equal(profile.specialRequirement?.isMet, false);
    assert.equal(profile.isComplete, false);
    await submissions("Catfish & Loaches", 5);
    assert.equal(
      (await accountProgress(memberId)).specialtyProgress.find(
        (a) => a.name === "Catfish Specialist"
      )!.isLimitationMet,
      false
    );
  });

  void test("account meta progress counts qualified grants; public counts all countable grants", async () => {
    await submissions("Anabantoids", 6);
    for (const name of [
      "Anabantoids Specialist",
      "Catfish Specialist",
      "Characins Specialist",
      "Cyprinids Specialist",
      "Marine Invertebrates & Corals Specialist",
      "Senior Specialist Award",
    ]) {
      await grantAward(memberId, name, new Date(), "manual");
    }
    const account = await accountProgress(memberId);
    const profile = await publicProgress(memberId);
    assert.equal(account.metaProgress[0].currentAwards, 1);
    assert.equal(account.metaProgress[0].percentage, 25);
    assert.equal(account.metaProgress[0].isCompleted, true);
    assert.equal(profile.metaAwards.seniorSpecialist.current, 4);
    assert.equal(profile.metaAwards.seniorSpecialist.required, 4);
    assert.equal(profile.metaAwards.seniorSpecialist.isGranted, true);
    assert.equal(profile.metaAwards.expertSpecialist.required, 7);
    assert.equal(profile.totalCompleted, 1);
  });
});

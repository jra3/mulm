import { createTestDatabase } from "./helpers/database";
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { correctPoints, resetNotifier, type Caller } from "@/lifecycle";
import { createSpecies, updateSpecies } from "@/species";
import { getSpecialtyAwardProgress as publicProgress, grantAward } from "@/db/members";
import {
  getSpecialtyAwardProgress as accountProgress,
  recomputeSpecialtyAwards,
} from "@/specialtyAwardManager";
import { createTestActors, type TestContext } from "./helpers/fixtures";
import { correctionOf, recordNotifications, submissionInState } from "./helpers/lifecycleFixtures";

void describe("Shared Specialty Award standing", () => {
  let ctx: TestContext;
  let committee: Caller;
  let sequence = 0;
  beforeEach(async () => {
    const database = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
    ctx = { ...database, ...(await createTestActors(database.db)) };
    committee = { id: ctx.admin.id, isAdmin: true };
    recordNotifications();
  });
  afterEach(async () => {
    resetNotifier();
    await ctx.cleanup();
  });

  async function evidence(speciesClass: string, count: number) {
    const rows: { id: number; speciesId: number }[] = [];
    for (let i = 0; i < count; i++) {
      const name = `evidence${++sequence}`;
      const speciesId = await createSpecies({
        canonicalGenus: "Testgenus",
        canonicalSpeciesName: name,
        programClass: speciesClass,
        speciesType: "Fish",
      });
      const id = await submissionInState(ctx.db, "approved", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        speciesId,
        speciesClass,
        latinName: `Testgenus ${name}`,
        commonName: name,
      });
      rows.push({ id, speciesId });
    }
    return rows;
  }

  const grants = () =>
    ctx.db.all<{ award_name: string; award_type: string }[]>(
      "SELECT award_name, award_type FROM awards WHERE member_id = ? ORDER BY award_name",
      ctx.member.id
    );

  void test("a correction revokes computed specialty and meta grants; manual specialties do not replace qualification", async () => {
    const anabantoids = await evidence("Anabantoids", 6);
    await evidence("Catfish & Loaches", 5);
    const characins = await evidence("Characins", 6);
    await evidence("Cyprinids", 10);
    await grantAward(ctx.member.id, "Livebearers Specialist", new Date(), "manual");
    const result = await recomputeSpecialtyAwards(ctx.member.id);
    assert.ok(result.granted.includes("Senior Specialist Award"));
    assert.equal(
      (await grants()).find((a) => a.award_name === "Senior Specialist Award")?.award_type,
      "meta_species"
    );
    await correctPoints(
      committee,
      anabantoids[5].id,
      await correctionOf(anabantoids[5].id, { species_id: characins[0].speciesId }),
      "Misidentified Species"
    );
    const names = (await grants()).map((a) => a.award_name);
    assert.equal(names.includes("Anabantoids Specialist"), false);
    assert.equal(names.includes("Senior Specialist Award"), false);
    assert.equal(names.includes("Livebearers Specialist"), true);
    const account = await accountProgress(ctx.member.id);
    const profile = await publicProgress(ctx.member.id);
    assert.equal(account.metaProgress[0].currentAwards, 3);
    assert.equal(profile.metaAwards.seniorSpecialist.current, 4);
    assert.equal(profile.metaAwards.seniorSpecialist.isGranted, false);
    assert.equal(
      profile.awards.find((a) => a.awardName === "Livebearers Specialist")!.isComplete,
      false
    );
    const feed = await ctx.db.all<{ related_id: string }[]>(
      "SELECT related_id FROM activity_feed WHERE activity_type = 'award_granted'"
    );
    assert.equal(
      feed.some((e) => e.related_id === "Senior Specialist Award"),
      false
    );
  });

  void test("losing the seventh specialty revokes Expert while Senior remains qualified", async () => {
    const anabantoids = await evidence("Anabantoids", 6);
    const characins = await evidence("Characins", 6);
    for (const [speciesClass, count] of [
      ["Catfish & Loaches", 5],
      ["Cyprinids", 10],
      ["Livebearers", 8],
      ["Cichlids - New World", 12],
      ["Cichlids - Old World", 12],
    ] as const) {
      await evidence(speciesClass, count);
    }
    const result = await recomputeSpecialtyAwards(ctx.member.id);
    assert.ok(result.granted.includes("Expert Specialist Award"));
    await correctPoints(
      committee,
      anabantoids[5].id,
      await correctionOf(anabantoids[5].id, { species_id: characins[0].speciesId }),
      "Misidentified Species"
    );
    const names = (await grants()).map((a) => a.award_name);
    assert.equal(names.includes("Expert Specialist Award"), false);
    assert.equal(names.includes("Senior Specialist Award"), true);
    assert.equal((await publicProgress(ctx.member.id)).metaAwards.expertSpecialist.current, 6);
    assert.equal((await accountProgress(ctx.member.id)).metaProgress[0].percentage, 100);
  });

  void test("shared facts retain spelling identity and exclude unapproved, unsubmitted, and other members' evidence", async () => {
    const rows = await evidence("Anabantoids", 6);
    // Different spellings of one bound Species still count separately under the existing rule.
    await ctx.db.run("UPDATE submissions SET species_id = ? WHERE member_id = ?", [
      rows[0].speciesId,
      ctx.member.id,
    ]);
    const latinName = (await ctx.db.get<{ species_latin_name: string }>(
      "SELECT species_latin_name FROM submissions WHERE id = ?",
      rows[0].id
    ))!.species_latin_name;
    const base = {
      memberId: ctx.member.id,
      witnessedBy: ctx.admin.id,
      speciesId: rows[0].speciesId,
      speciesClass: "Anabantoids",
    };
    await submissionInState(ctx.db, "approved", { ...base, latinName: latinName.toUpperCase() });
    await submissionInState(ctx.db, "pendingWitness", { ...base, latinName: "Pending species" });
    const draft = await submissionInState(ctx.db, "draft", { ...base, latinName: "Draft species" });
    // Even malformed legacy evidence with approval but no submitted date stays excluded.
    await ctx.db.run("UPDATE submissions SET approved_on = '2026-01-01' WHERE id = ?", draft);
    await submissionInState(ctx.db, "approved", {
      ...base,
      memberId: ctx.admin.id,
      latinName: "Other member species",
    });
    assert.equal((await accountProgress(ctx.member.id)).specialtyProgress[0].currentSpecies, 6);
    assert.equal((await publicProgress(ctx.member.id)).awards[0].currentSpecies, 6);
    assert.deepEqual(await recomputeSpecialtyAwards(ctx.member.id), {
      granted: ["Anabantoids Specialist"],
      revoked: [],
    });
  });

  void test("manual specialty and meta grants retain ownership when qualification is earned and lost", async () => {
    await grantAward(ctx.member.id, "Anabantoids Specialist", new Date(), "manual");
    await grantAward(ctx.member.id, "Senior Specialist Award", new Date(), "manual");
    const rows = await evidence("Anabantoids", 6);
    assert.deepEqual(await recomputeSpecialtyAwards(ctx.member.id), { granted: [], revoked: [] });
    assert.equal((await accountProgress(ctx.member.id)).specialtyProgress[0].isCompleted, true);
    await updateSpecies(rows[0].speciesId, { programClass: "Characins" });
    assert.deepEqual(await recomputeSpecialtyAwards(ctx.member.id), { granted: [], revoked: [] });
    assert.deepEqual(
      (await grants()).map((a) => a.award_type),
      ["manual", "manual"]
    );
    const account = await accountProgress(ctx.member.id);
    const profile = await publicProgress(ctx.member.id);
    assert.equal(account.specialtyProgress[0].isCompleted, false);
    assert.equal(account.metaProgress[0].currentAwards, 0);
    assert.equal(account.metaProgress[0].isCompleted, true);
    assert.equal(profile.awards[0].isComplete, false);
    assert.equal(profile.awards[0].isGranted, true);
    assert.equal(profile.metaAwards.seniorSpecialist.current, 1);
  });

  void test("both pages and recomputation follow changes to the bound Species' Program class", async () => {
    const rows = await evidence("Anabantoids", 6);
    await recomputeSpecialtyAwards(ctx.member.id);
    await updateSpecies(rows[0].speciesId, { programClass: "Characins" });
    const account = await accountProgress(ctx.member.id);
    const profile = await publicProgress(ctx.member.id);
    assert.equal(account.specialtyProgress[0].currentSpecies, 5);
    assert.equal(account.specialtyProgress[0].isCompleted, false);
    assert.equal(profile.awards[0].currentSpecies, 5);
    assert.equal(profile.awards[0].isComplete, false);
    assert.equal(profile.awards[0].isGranted, true);
    assert.deepEqual(await recomputeSpecialtyAwards(ctx.member.id), {
      granted: [],
      revoked: ["Anabantoids Specialist"],
    });
    await updateSpecies(rows[0].speciesId, { programClass: "Anabantoids" });
    assert.deepEqual(await recomputeSpecialtyAwards(ctx.member.id), {
      granted: ["Anabantoids Specialist"],
      revoked: [],
    });
    assert.equal((await accountProgress(ctx.member.id)).specialtyProgress[0].isCompleted, true);
    assert.equal((await publicProgress(ctx.member.id)).awards[0].isComplete, true);
  });
});

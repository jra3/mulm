import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  approve,
  correctPoints,
  recomputeStanding,
  resetNotifier,
  type Caller,
} from "@/lifecycle";
import { query } from "@/db/conn";
import { getMember } from "@/db/members";
import {
  mockApprovalData,
  mockSpeciesIds,
  setupTestDatabase,
  teardownTestDatabase,
  type TestContext,
} from "./helpers/testHelpers";
import {
  recordNotifications,
  submissionInState,
  type RecordingNotifier,
} from "./helpers/lifecycleFixtures";

/**
 * A member's standing, recomputed from their approved Submissions.
 *
 * Symmetric in both halves: a Level can drop and a Specialty Award can be
 * taken back, because the Level shown against a member's name must be one
 * their approved Submissions actually support.
 */

void describe("Submission lifecycle - standing", () => {
  let ctx: TestContext;
  let sent: RecordingNotifier;
  let committee: Caller;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 });
    sent = recordNotifications();
    committee = { id: ctx.admin.id, isAdmin: true };
  });

  afterEach(async () => {
    resetNotifier();
    await teardownTestDatabase(ctx);
  });

  const feed = () =>
    query<{ activity_type: string; related_id: string; activity_data: string }>(
      "SELECT activity_type, related_id, activity_data FROM activity_feed ORDER BY id"
    );

  const awards = () =>
    query<{ award_name: string }>("SELECT award_name FROM awards WHERE member_id = ?", [
      ctx.member.id,
    ]);

  /** Approve `count` Anabantoid Submissions, one per distinct species. */
  async function approveAnabantoids(count: number, points = 10): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        speciesClass: "Anabantoids",
        latinName: `Betta species${i}`,
        commonName: `Betta ${i}`,
      });
      await approve(committee, id, mockSpeciesIds, { ...mockApprovalData, points });
      ids.push(id);
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Levels
  // -------------------------------------------------------------------------

  void describe("Levels", () => {
    void test("a rise congratulates the member and posts to the feed", async () => {
      await approveAnabantoids(3, 10); // 30 points: past Hobbyist at 25

      const member = await getMember(ctx.member.id);
      assert.strictEqual(member!.fish_level, "Hobbyist");

      // Two rises on the way up: onto the ladder at all, then to Hobbyist.
      const levelUps = sent.of("levelUp");
      assert.deepStrictEqual(levelUps.map((l) => l.about), [
        "fish:Participant",
        "fish:Hobbyist",
      ]);
      assert.deepStrictEqual(levelUps[0].to, [ctx.member.contact_email]);

      // One feed entry per member and Program, refreshed rather than appended,
      // so the front page shows where they stand and not how they got there.
      const entries = (await feed()).filter((e) => e.activity_type === "level_up");
      assert.strictEqual(entries.length, 1);
      assert.match(entries[0].activity_data, /"level":"Hobbyist"/);
    });

    void test("a drop tells nobody", async () => {
      const ids = await approveAnabantoids(3, 10);
      assert.strictEqual((await getMember(ctx.member.id))!.fish_level, "Hobbyist");
      sent.clear();

      // Down to 15 points, below Hobbyist's threshold of 25.
      for (const id of ids) {
        await correctPoints(committee, id, { points: 5 }, "Wrong point class");
      }

      assert.strictEqual((await getMember(ctx.member.id))!.fish_level, "Participant");
      assert.deepStrictEqual(
        sent.of("levelUp"),
        [],
        "a demotion describes a consequence whose cause the member was never told"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Specialty Awards
  // -------------------------------------------------------------------------

  void describe("Specialty Awards", () => {
    void test("earning one congratulates the member and posts to the feed", async () => {
      await approveAnabantoids(6);

      assert.deepStrictEqual(
        (await awards()).map((a) => a.award_name),
        ["Anabantoids Specialist"]
      );

      const letters = sent.of("specialtyAward");
      assert.strictEqual(letters.length, 1, "an achievement, not a row appearing in a list");
      assert.strictEqual(letters[0].about, "Anabantoids Specialist");

      const entries = (await feed()).filter((e) => e.activity_type === "award_granted");
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].related_id, "Anabantoids Specialist");
    });

    void test("a correction to the species takes the Award back, and its feed entry with it", async () => {
      const ids = await approveAnabantoids(6);
      assert.strictEqual((await awards()).length, 1);
      sent.clear();

      // The sixth was misidentified: it was never an Anabantoid.
      await correctPoints(
        committee,
        ids[5],
        { species_class: "Catfish & Loaches" },
        "Misidentified species"
      );

      assert.deepStrictEqual(
        (await awards()).map((a) => a.award_name),
        [],
        "an Award must not stand on evidence that no longer exists"
      );
      assert.strictEqual(
        (await feed()).filter((e) => e.activity_type === "award_granted").length,
        0,
        "the feed holds an entry exactly as long as the thing it announces"
      );
      assert.deepStrictEqual(sent.of("specialtyAward"), [], "a revocation tells nobody");
    });

    void test("the recompute runs on any change, not only when Points changed", async () => {
      const ids = await approveAnabantoids(6);
      sent.clear();

      // Nothing about the Points moves here - only the species class does, and
      // that is exactly what Specialty Awards key on.
      await correctPoints(
        committee,
        ids[0],
        { species_class: "Characins" },
        "Misidentified species"
      );

      assert.deepStrictEqual((await awards()).map((a) => a.award_name), []);
    });

    void test("an Award a committee member granted by hand is not the recompute's to take back", async () => {
      await ctx.db.run(
        "INSERT INTO awards (member_id, award_name, date_awarded, award_type) VALUES (?, ?, ?, 'manual')",
        [ctx.member.id, "Breeder of the Year", new Date().toISOString()]
      );

      await recomputeStanding(ctx.member.id, "fish");

      assert.deepStrictEqual(
        (await awards()).map((a) => a.award_name),
        ["Breeder of the Year"]
      );
    });
  });

  // -------------------------------------------------------------------------
  // The feed's invariant
  // -------------------------------------------------------------------------

  void test("the feed never advertises the same approval twice", async () => {
    const [id] = await approveAnabantoids(1);

    await correctPoints(committee, id, { points: 20 }, "Wrong point class");
    await correctPoints(committee, id, { points: 15 }, "Wrong again");

    const approvals = (await feed()).filter((e) => e.activity_type === "submission_approved");
    assert.strictEqual(approvals.length, 1);
    assert.match(approvals[0].activity_data, /"points":15/);
  });
});

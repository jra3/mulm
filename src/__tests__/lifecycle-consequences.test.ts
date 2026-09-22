import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  approve,
  confirmWitness,
  correctPoints,
  createSubmission,
  deleteSubmission,
  enterApprovalQueue,
  removeFromQueue,
  requestChanges,
  resetNotifier,
  resubmit,
  returnToDraft,
  saveChanges,
  saveDraft,
  sendCommitteeDigest,
  submissionsDueForMeetingReminder,
  sendMeetingReminder,
  type Caller,
} from "@/lifecycle";
import { query } from "@/db/conn";
import { updateMember } from "@/db/members";
import { markFinalSubmissionReminderSent } from "@/db/submissions";
import {
  mockApprovalData,
  setupTestDatabase,
  teardownTestDatabase,
  type TestContext,
} from "./helpers/testHelpers";
import {
  readSubmission,
  recordNotifications,
  requestChangesFixture,
  submissionInState,
  type RecordingNotifier,
} from "./helpers/lifecycleFixtures";
import type { FormValues } from "@/forms/submission";

/**
 * The consequence matrix: who is told, what the feed says, and - just as much
 * of the point - which moves tell nobody.
 *
 * Email recipients are the one consequence not observable in the database, so
 * these tests swap the notifier for a recorder. Everything else is asserted
 * against the rows the transition wrote.
 */

const form: FormValues = {
  species_type: "Fish",
  species_class: "Livebearers",
  species_common_name: "Guppy",
  species_latin_name: "Poecilia reticulata",
  water_type: "Fresh",
  count: "20",
  reproduction_date: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  foods: ["Flakes"],
  spawn_locations: ["Plants"],
  tank_size: "10",
  filter_type: "Sponge",
  water_change_volume: "50%",
  water_change_frequency: "Weekly",
  temperature: "75",
  ph: "7.0",
};

void describe("Submission lifecycle - consequences", () => {
  let ctx: TestContext;
  let sent: RecordingNotifier;
  let member: Caller;
  let committee: Caller;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 });
    sent = recordNotifications();
    member = { id: ctx.member.id, isAdmin: false };
    committee = { id: ctx.admin.id, isAdmin: true };
  });

  afterEach(async () => {
    resetNotifier();
    await teardownTestDatabase(ctx);
  });

  const at = (state: Parameters<typeof submissionInState>[1]) =>
    submissionInState(ctx.db, state, { memberId: ctx.member.id, witnessedBy: ctx.admin.id });

  const feed = () =>
    query<{ activity_type: string; related_id: string; activity_data: string }>(
      "SELECT activity_type, related_id, activity_data FROM activity_feed ORDER BY id"
    );

  // -------------------------------------------------------------------------
  // The member's letters
  // -------------------------------------------------------------------------

  void test("submitting confirms receipt to the member, and to nobody else", async () => {
    await createSubmission(member, ctx.member.id, form, { submit: true });

    assert.deepStrictEqual(sent.kinds, ["submissionReceived"]);
    assert.deepStrictEqual(
      sent.of("submissionReceived")[0].to,
      [ctx.member.contact_email],
      "the committee is no longer cc'd on a letter addressed to the member"
    );
  });

  void test("saving a draft tells nobody", async () => {
    const id = await createSubmission(member, ctx.member.id, form, { submit: false });
    sent.clear();

    await saveDraft(member, id, form);

    assert.deepStrictEqual(sent.kinds, []);
  });

  void test("editing in place tells nobody", async () => {
    const id = await at("waitingPeriod");
    sent.clear();

    await saveChanges(member, id, { ...form, reproduction_date: new Date().toISOString() });

    // The edit voids the Witness (ADR-0001), and that too is told to nobody:
    // the form warned the member, and the witness queue is the committee's notice.
    assert.deepStrictEqual(
      sent.kinds,
      [],
      "fixing a detail must not put a second copy of the Submission in three inboxes"
    );
  });

  void test("returning to draft tells nobody", async () => {
    const id = await at("waitingPeriod");
    sent.clear();

    await returnToDraft(member, id);

    assert.deepStrictEqual(sent.kinds, []);
  });

  void test("confirming the Witness tells the member their spawn was inspected", async () => {
    const id = await at("pendingWitness");
    sent.clear();

    await confirmWitness(committee, id);

    assert.deepStrictEqual(sent.kinds, ["witnessConfirmed"]);
    assert.deepStrictEqual(sent.of("witnessConfirmed")[0].to, [ctx.member.contact_email]);
  });

  void test("entering and leaving the approval queue tells nobody by mail", async () => {
    const id = await at("awaitingFinalSubmission");
    sent.clear();

    await enterApprovalQueue(member, id);
    await removeFromQueue(member, id);

    assert.deepStrictEqual(
      sent.kinds,
      [],
      "the committee learns from the digest, not from per-event mail"
    );
  });

  void test("requesting changes tells the member what the committee wants", async () => {
    const id = await at("waitingPeriod");
    sent.clear();

    await requestChanges(committee, id, "The photos are too blurry to see the fry");

    assert.deepStrictEqual(sent.kinds, ["changesRequested"]);
    assert.deepStrictEqual(sent.of("changesRequested")[0].to, [ctx.member.contact_email]);
    assert.deepStrictEqual(sent.reasons, ["The photos are too blurry to see the fry"]);
  });

  void test("resubmitting tells nobody - the committee's queue is the notice", async () => {
    const id = await at("waitingPeriod");
    await requestChangesFixture(id, ctx.admin.id);
    sent.clear();

    await resubmit(member, id, { ...form, reproduction_date: new Date().toISOString() });

    assert.deepStrictEqual(sent.kinds, []);
  });

  void test("the waiting period elapsing nudges the member once", async () => {
    const id = await at("awaitingFinalSubmission");
    sent.clear();

    const due = await submissionsDueForMeetingReminder();
    assert.deepStrictEqual(
      due.map((d) => d.id),
      [id]
    );

    await sendMeetingReminder(due[0]);
    await markFinalSubmissionReminderSent(id);

    assert.deepStrictEqual(sent.kinds, ["waitingPeriodComplete"]);
    assert.deepStrictEqual(
      (await submissionsDueForMeetingReminder()).map((d) => d.id),
      [],
      "the sent-flag stops it arriving twice"
    );
  });

  void test("only work awaiting a meeting is due a nudge", async () => {
    await at("waitingPeriod");
    await at("inApprovalQueue");
    await at("pendingWitness");

    assert.deepStrictEqual(await submissionsDueForMeetingReminder(), []);
  });

  // -------------------------------------------------------------------------
  // Deleting
  // -------------------------------------------------------------------------

  void test("a member deleting their own draft is told nothing", async () => {
    const id = await at("draft");
    sent.clear();

    await deleteSubmission(member, id);

    assert.deepStrictEqual(sent.kinds, []);
  });

  void test("the committee deleting someone else's work explains itself", async () => {
    const id = await at("pendingWitness");
    sent.clear();

    await deleteSubmission(committee, id);

    assert.deepStrictEqual(sent.kinds, ["deletedByCommittee"]);
    assert.deepStrictEqual(sent.of("deletedByCommittee")[0].to, [ctx.member.contact_email]);
  });

  // -------------------------------------------------------------------------
  // Approving, and correcting an approval
  // -------------------------------------------------------------------------

  void test("approving tells the member and posts one feed entry", async () => {
    const id = await at("inApprovalQueue");
    sent.clear();

    await approve(committee, id, { ...mockApprovalData, points: 10 });

    assert.ok(sent.kinds.includes("approved"));
    assert.deepStrictEqual(sent.of("approved")[0].to, [ctx.member.contact_email]);

    const entries = await feed();
    const approvals = entries.filter((e) => e.activity_type === "submission_approved");
    assert.strictEqual(approvals.length, 1);
    assert.strictEqual(approvals[0].related_id, String(id));
  });

  void test("correcting an approval updates its entry rather than announcing it again", async () => {
    const id = await at("inApprovalQueue");
    await approve(committee, id, { ...mockApprovalData, points: 10 });
    sent.clear();

    await correctPoints(committee, id, { points: 20 }, "Wrong point class");

    const approvals = (await feed()).filter((e) => e.activity_type === "submission_approved");
    assert.strictEqual(approvals.length, 1, "one entry per approval, not one per edit");
    assert.match(approvals[0].activity_data, /"points":20/);

    assert.ok(
      !sent.kinds.includes("approved"),
      "fixing a mistake must not re-announce the approval to the member"
    );
  });

  void test("correcting an approval emails the member nothing at all", async () => {
    const id = await at("inApprovalQueue");
    await approve(committee, id, { ...mockApprovalData, points: 10 });
    sent.clear();

    await correctPoints(committee, id, { points: 5 }, "Wrong point class");

    assert.deepStrictEqual(
      sent.kinds.filter((kind) => kind !== "levelUp" && kind !== "specialtyAward"),
      [],
      "their standing page already shows the truth"
    );
  });

  void test("approving is the only way Points are ever awarded", async () => {
    const id = await at("inApprovalQueue");
    assert.strictEqual((await readSubmission(id))!.points, null);

    await approve(committee, id, { ...mockApprovalData, points: 15 });

    assert.strictEqual((await readSubmission(id))!.points, 15);
  });

  // -------------------------------------------------------------------------
  // The committee's digest
  // -------------------------------------------------------------------------

  void describe("the committee's daily digest", () => {
    beforeEach(async () => {
      await updateMember(ctx.admin.id, { is_admin: 1 });
    });

    void test("no digest at all when every queue is empty", async () => {
      sent.clear();
      assert.strictEqual(await sendCommitteeDigest(), false);
      assert.deepStrictEqual(sent.kinds, []);
    });

    void test("a submitted Submission puts the committee in the digest", async () => {
      await at("pendingWitness");
      sent.clear();

      assert.strictEqual(await sendCommitteeDigest(), true);
      assert.deepStrictEqual(sent.kinds, ["committeeDigest"]);
      assert.deepStrictEqual(sent.of("committeeDigest")[0].to, [ctx.admin.contact_email]);
    });

    void test("it keeps arriving while a queue is non-empty", async () => {
      await at("inApprovalQueue");
      sent.clear();

      assert.strictEqual(await sendCommitteeDigest(), true);
      assert.strictEqual(await sendCommitteeDigest(), true);
      assert.strictEqual(sent.of("committeeDigest").length, 2);
    });

    void test("work the committee has sent back leaves the digest until the member answers", async () => {
      const id = await at("inApprovalQueue");
      await requestChanges(committee, id, "Please add a photo");
      sent.clear();

      assert.strictEqual(
        await sendCommitteeDigest(),
        false,
        "a queue must not advertise work nobody on the committee may act on"
      );

      await resubmit(member, id, { ...form, reproduction_date: new Date().toISOString() });
      assert.strictEqual(await sendCommitteeDigest(), true, "and it comes back when they answer");
    });

    void test("work in its waiting period is waiting on the clock, not the committee", async () => {
      await submissionInState(ctx.db, "waitingPeriod", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
      });
      sent.clear();

      assert.strictEqual(await sendCommitteeDigest(), false);
    });
  });
});

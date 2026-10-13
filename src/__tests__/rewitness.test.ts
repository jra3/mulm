import { createTestDatabase } from "./helpers/database";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  confirmWitness,
  membersAwaitingRewitnessEmail,
  originalWitnessFromNotes,
  resetNotifier,
  sendRewitnessEmails,
  WITNESS_RESET_NOTE,
  type Caller,
} from "@/lifecycle";
import { addNote } from "@/db/submission_notes";
import { getSetting } from "@/db/settings";
import { updateMember } from "@/db/members";
import {
  createTestMember,
  createRawSubmissionFixture,
  ensureGuppySpecies,
  createTestActors,
  type TestContext,
  type TestMember,
} from "./helpers/fixtures";
import { recordNotifications, witnessPoints, type RecordingNotifier } from "./helpers/lifecycleFixtures";

/**
 * The reset migration's consequences (#524): the witness panel learns the
 * original witness from the note the migration wrote, and the post-deploy
 * script tells each affected member once that nothing is wrong.
 */

const RESET_NOTE = "Witness reset when points moved to the Witness; originally witnessed by Pat on 2026-01-02";
const note = (text: string) => ({ note_text: text });

void describe("The original witness is read from the reset note", () => {
  void test("a reset note names the witness and the day", () => {
    assert.deepStrictEqual(originalWitnessFromNotes([note(RESET_NOTE)]), { name: "Pat", date: "2026-01-02" });
    assert.deepStrictEqual(
      originalWitnessFromNotes([
        note("Witness reset when points moved to the Witness; originally witnessed by Mary Ann O'Neil on 2025-12-30"),
      ]),
      { name: "Mary Ann O'Neil", date: "2025-12-30" }
    );
    assert.deepStrictEqual(
      originalWitnessFromNotes([
        note(
          "Witness reset when points moved to the Witness; originally witnessed by a former committee member on 2026-01-02"
        ),
      ]),
      { name: "a former committee member", date: "2026-01-02" }
    );
  });

  void test("the note is the one the migration writes", () => {
    // The TypeScript side and 066-reset-pointless-witnesses.sql must agree on
    // the wording, or the panel shows nobody.
    assert.strictEqual(WITNESS_RESET_NOTE("Pat", "2026-01-02"), RESET_NOTE);
  });

  void test("nothing else counts: other prose, a changelog entry, or no notes at all", () => {
    assert.strictEqual(originalWitnessFromNotes([]), null);
    assert.strictEqual(
      originalWitnessFromNotes([
        note("Asked Pat whether the Witness reset when points moved to the Witness applies here"),
        note(JSON.stringify({ type: "admin_edit", changes: [{ field: "species", old: null, new: "x" }], reason: "r" })),
        note("Please add a photo of the fry"),
      ]),
      null
    );
  });

  void test("the latest reset note wins", () => {
    assert.deepStrictEqual(
      originalWitnessFromNotes([
        note(RESET_NOTE),
        note("Witness reset when points moved to the Witness; originally witnessed by Sam on 2026-02-03"),
      ]),
      { name: "Sam", date: "2026-02-03" }
    );
  });
});

void describe("Affected members are told once that nothing is wrong", () => {
  let ctx: TestContext;
  let sent: RecordingNotifier;
  let committee: Caller;

  const resetRow = async (member: TestMember, options: { reproductionDate?: string; approved?: boolean } = {}) => {
    const id = await createRawSubmissionFixture(ctx.db, {
      memberId: member.id,
      submitted: true,
      witnessStatus: options.approved ? "confirmed" : "pending",
      approved: options.approved,
      approvedBy: options.approved ? ctx.admin.id : undefined,
      witnessedBy: options.approved ? ctx.admin.id : undefined,
      speciesId: await ensureGuppySpecies(ctx.db),
      reproductionDate: options.reproductionDate,
    });
    await addNote(id, ctx.admin.id, RESET_NOTE);
    return id;
  };

  beforeEach(async () => {
    const database = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
    ctx = { ...database, ...(await createTestActors(database.db, { adminCount: 1 })) };
    sent = recordNotifications();
    committee = { id: ctx.admin.id, isAdmin: true };
  });

  afterEach(async () => {
    resetNotifier();
    await ctx.cleanup();
  });

  void test("one email per member, covering every reset Submission still awaiting a Witness", async () => {
    const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const first = await resetRow(ctx.member, { reproductionDate: longAgo });
    const second = await resetRow(ctx.member, { reproductionDate: recent });
    // Re-witnessed already: the points email has told them
    const other = await createTestMember({ displayName: "Re Witnessed", email: "rewitnessed@test.com" });
    const rewitnessed = await resetRow(other);
    await confirmWitness(committee, rewitnessed, witnessPoints());
    sent.clear();
    // Approved since: nothing pending at all
    const done = await createTestMember({ displayName: "All Done", email: "done@test.com" });
    await resetRow(done, { approved: true });
    // Awaiting a Witness for the first time, never reset
    const fresh = await createTestMember({ displayName: "Fresh", email: "fresh@test.com" });
    await createRawSubmissionFixture(ctx.db, { memberId: fresh.id, submitted: true, witnessStatus: "pending" });

    const due = await membersAwaitingRewitnessEmail();
    assert.deepStrictEqual(
      due.map((letter) => [letter.member.id, letter.submissions.map((s) => s.id)]),
      [[ctx.member.id, [first, second]]]
    );
    const [letter] = due;
    assert.deepStrictEqual(letter.submissions[0].originalWitness, { name: "Pat", date: "2026-01-02" });
    assert.strictEqual(letter.submissions[0].waitingPeriodOver, true);
    assert.strictEqual(letter.submissions[1].waitingPeriodOver, false);
    assert.match(letter.submissions[1].readyOn, /^\d{4}-\d{2}-\d{2}$/);

    const result = await sendRewitnessEmails();

    assert.deepStrictEqual(result, { emailed: 1, skipped: 0, failed: 0 });
    assert.deepStrictEqual(sent.sent, [
      { kind: "rewitnessPending", to: [ctx.member.contact_email], about: `${first},${second}` },
    ]);
  });

  void test("a second run emails nobody: the send is recorded per member", async () => {
    await resetRow(ctx.member);
    await sendRewitnessEmails();
    sent.clear();

    const again = await sendRewitnessEmails();

    assert.deepStrictEqual(again, { emailed: 0, skipped: 0, failed: 0 });
    assert.deepStrictEqual(sent.sent, []);
    assert.deepStrictEqual(await membersAwaitingRewitnessEmail(), []);
    assert.ok(await getSetting(`rewitness_emailed:${ctx.member.id}`), "the send is on record");
  });

  void test("a member with no contact email is skipped and not recorded, so a later run reaches them", async () => {
    await resetRow(ctx.member);
    await updateMember(ctx.member.id, { contact_email: "" });

    const result = await sendRewitnessEmails();

    assert.deepStrictEqual(result, { emailed: 0, skipped: 1, failed: 0 });
    assert.deepStrictEqual(sent.sent, []);
    assert.strictEqual(await getSetting(`rewitness_emailed:${ctx.member.id}`), null);

    await updateMember(ctx.member.id, { contact_email: "found@test.com" });
    assert.deepStrictEqual(await sendRewitnessEmails(), { emailed: 1, skipped: 0, failed: 0 });
  });

  void test("a letter that does not get through is not recorded either", async () => {
    await resetRow(ctx.member);
    sent.deliver = false;

    const result = await sendRewitnessEmails();

    assert.deepStrictEqual(result, { emailed: 0, skipped: 0, failed: 1 });
    assert.strictEqual(await getSetting(`rewitness_emailed:${ctx.member.id}`), null);
  });
});

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { runFinalSubmissionReminders } from "@/scheduled/finalSubmissionReminder";
import { getSubmissionById } from "../db/submissions";
import { confirmWitness, resetNotifier, saveChanges } from "@/lifecycle";
import type { FormValues } from "@/forms/submission";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  ensureGuppySpecies,
  type TestContext,
} from "./helpers/testHelpers";
import { readSubmission, recordNotifications, requestChangesFixture, witnessPoints } from "./helpers/lifecycleFixtures";

/**
 * Tests for the daily waiting-period reminder job. Emails are disabled under
 * NODE_ENV=test, so onWaitingPeriodComplete is a no-op success; this exercises
 * the selection (the approval queue, less the rows already reminded) and the
 * idempotent "mark reminded" bookkeeping.
 */

const SIXTY_FIVE_DAYS_AGO = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const reminded = async (id: number): Promise<boolean> => {
  const sub = await getSubmissionById(id);
  return Boolean(sub?.final_submission_reminder_sent_on);
};

void describe("Final-submission reminder job", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 1 });
    recordNotifications();
  });

  afterEach(async () => {
    resetNotifier();
    await teardownTestDatabase(ctx);
  });

  void test("reminds a submission in the approval queue once, with no member action", async () => {
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
    });

    const result = await runFinalSubmissionReminders();

    assert.strictEqual(result.sent, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(await reminded(id), true);
  });

  void test("does not remind a submission still in its waiting period", async () => {
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: TEN_DAYS_AGO,
    });

    const result = await runFinalSubmissionReminders();

    assert.strictEqual(result.sent, 0);
    assert.strictEqual(await reminded(id), false);
  });

  void test("does not remind an unconfirmed submission", async () => {
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "pending",
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
    });

    await runFinalSubmissionReminders();

    assert.strictEqual(await reminded(id), false);
  });

  void test("does not remind a submission the committee has sent back", async () => {
    // It selects from the approval queue, which flagged work leaves; the
    // member's answer voids the Witness, and the clock puts it back once
    // re-witnessed.
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
    });
    await requestChangesFixture(id, ctx.admin.id);

    const result = await runFinalSubmissionReminders();

    assert.strictEqual(result.sent, 0);
    assert.strictEqual(await reminded(id), false);
  });

  void test("fires once per Submission: a re-witness does not earn a second reminder", async () => {
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
      speciesId: await ensureGuppySpecies(ctx.db),
    });
    assert.strictEqual((await runFinalSubmissionReminders()).sent, 1);

    // The member's save voids the Witness; the committee confirms it again
    const before = (await readSubmission(id))!;
    const form: FormValues = {
      species_type: "Fish",
      species_class: "Livebearers",
      species_common_name: before.species_common_name,
      species_latin_name: before.species_latin_name,
      water_type: "Fresh",
      count: "20",
      reproduction_date: before.reproduction_date,
      foods: ["Flakes"],
      spawn_locations: ["Plants"],
      tank_size: "10",
      filter_type: "Sponge",
      water_change_volume: "50%",
      water_change_frequency: "Weekly",
      temperature: "75",
      ph: "7.0",
    };
    await saveChanges({ id: ctx.member.id, isAdmin: false }, id, form);
    await confirmWitness({ id: ctx.admin.id, isAdmin: true }, id, witnessPoints());

    assert.strictEqual((await runFinalSubmissionReminders()).sent, 0);
    assert.strictEqual(await reminded(id), true);
  });

  void test("is idempotent: a second run does not re-remind", async () => {
    await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
    });

    const first = await runFinalSubmissionReminders();
    const second = await runFinalSubmissionReminders();

    assert.strictEqual(first.sent, 1);
    assert.strictEqual(second.sent, 0);
  });
});

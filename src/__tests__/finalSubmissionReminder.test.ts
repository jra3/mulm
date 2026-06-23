import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { runFinalSubmissionReminders } from "@/scheduled/finalSubmissionReminder";
import { getSubmissionById, setFinalSubmission } from "../db/submissions";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSubmission,
  type TestContext,
} from "./helpers/testHelpers";

/**
 * Tests for the daily final-submission reminder job. Emails are disabled under
 * NODE_ENV=test, so onWaitingPeriodComplete is a no-op success — this exercises
 * the selection query and the idempotent "mark reminded" bookkeeping.
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
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("reminds a confirmed, past-waiting-period submission once", async () => {
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

  void test("does not remind a submission already marked final-submitted", async () => {
    const id = await createTestSubmission(ctx.db, {
      memberId: ctx.member.id,
      submitted: true,
      witnessStatus: "confirmed",
      witnessedBy: ctx.admin.id,
      reproductionDate: SIXTY_FIVE_DAYS_AGO,
    });
    await setFinalSubmission(id, ctx.member.id, false);

    const result = await runFinalSubmissionReminders();

    assert.strictEqual(result.sent, 0);
    assert.strictEqual(await reminded(id), false);
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

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  COMMITTEE_QUEUES,
  filterQueue,
  inQueue,
  queueFor,
  queueSql,
  resetNotifier,
  type QueueName,
  type SubmissionState,
} from "@/lifecycle";
import { getQueue, getQueueCounts, type Submission } from "@/db/submissions";
import { query } from "@/db/conn";
import { setupTestDatabase, teardownTestDatabase, type TestContext } from "./helpers/testHelpers";
import { recordNotifications, requestChangesFixture, submissionInState } from "./helpers/lifecycleFixtures";

/**
 * Queue membership, defined once per queue.
 *
 * The four queues are exactly the four middle states, which is what makes the
 * disagreement this work removes impossible: no Submission can be claimed by
 * two of them.
 */

const ALL_QUEUES: QueueName[] = [
  "witness",
  "waitingPeriod",
  "awaitingFinalSubmission",
  "approval",
];

/** Which queue each state belongs to. Draft and Approved belong to none. */
const QUEUE_OF: Partial<Record<SubmissionState, QueueName>> = {
  pendingWitness: "witness",
  waitingPeriod: "waitingPeriod",
  awaitingFinalSubmission: "awaitingFinalSubmission",
  inApprovalQueue: "approval",
};

const EVERY_STATE: SubmissionState[] = [
  "draft",
  "pendingWitness",
  "waitingPeriod",
  "awaitingFinalSubmission",
  "inApprovalQueue",
  "approved",
];

void describe("Submission lifecycle - queues", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 });
    recordNotifications();
  });

  afterEach(async () => {
    resetNotifier();
    await teardownTestDatabase(ctx);
  });

  const at = (state: SubmissionState) =>
    submissionInState(ctx.db, state, { memberId: ctx.member.id, witnessedBy: ctx.admin.id });

  const rows = () => query<Submission>("SELECT * FROM submissions");

  void describe("each state lands in exactly one queue", () => {
    for (const state of EVERY_STATE) {
      void test(`a ${state} Submission is in ${QUEUE_OF[state] ?? "no queue"}`, async () => {
        const id = await at(state);
        const row = (await rows()).find((r) => r.id === id)!;

        assert.strictEqual(queueFor(row), QUEUE_OF[state] ?? null);

        const claiming = ALL_QUEUES.filter((queue) => inQueue(queue, row));
        assert.ok(claiming.length <= 1, `claimed by ${claiming.join(" and ")}`);
      });
    }
  });

  void test("no two queues ever claim the same Submission", async () => {
    for (const state of EVERY_STATE) {
      await at(state);
    }
    const all = await rows();

    const claims = new Map<number, QueueName[]>();
    for (const queue of ALL_QUEUES) {
      for (const row of filterQueue(queue, all)) {
        claims.set(row.id, [...(claims.get(row.id) ?? []), queue]);
      }
    }

    for (const [id, queues] of claims) {
      assert.strictEqual(queues.length, 1, `submission ${id} is in ${queues.join(" and ")}`);
    }
  });

  void test("the approval queue and the waiting-period list cannot overlap", async () => {
    await at("waitingPeriod");
    await at("awaitingFinalSubmission");
    const queued = await at("inApprovalQueue");

    const approval = await getQueue("approval", "fish");
    const waiting = await getQueue("waitingPeriod", "fish");
    const awaiting = await getQueue("awaitingFinalSubmission", "fish");

    assert.deepStrictEqual(
      approval.map((s) => s.id),
      [queued]
    );
    assert.ok(!waiting.some((s) => s.id === queued));
    assert.ok(!awaiting.some((s) => s.id === queued));
  });

  void describe("work the committee has sent back", () => {
    for (const queue of COMMITTEE_QUEUES) {
      const state = (
        Object.entries(QUEUE_OF).find(([, q]) => q === queue) as [SubmissionState, QueueName]
      )[0];

      void test(`leaves the ${queue} queue while changes are outstanding`, async () => {
        const id = await at(state);
        assert.ok((await getQueue(queue, "fish")).some((s) => s.id === id));

        await requestChangesFixture(id, ctx.admin.id);

        assert.ok(
          !(await getQueue(queue, "fish")).some((s) => s.id === id),
          "a committee queue must show only what is waiting on the committee"
        );
      });
    }

    void test("but keeps its place in the queues that are waiting on the clock", async () => {
      const id = await at("waitingPeriod");
      await requestChangesFixture(id, ctx.admin.id);

      assert.ok(
        (await getQueue("waitingPeriod", "fish")).some((s) => s.id === id),
        "it still has a waiting period to serve"
      );
    });
  });

  void test("queues are scoped to a Program", async () => {
    await submissionInState(ctx.db, "pendingWitness", {
      memberId: ctx.member.id,
      program: "plant",
      speciesType: "Plant",
    });

    assert.strictEqual((await getQueue("witness", "fish")).length, 0);
    assert.strictEqual((await getQueue("witness", "plant")).length, 1);
  });

  void test("counts agree with the rows the queue returns", async () => {
    await at("pendingWitness");
    await at("pendingWitness");
    await at("inApprovalQueue");

    assert.deepStrictEqual(await getQueueCounts("witness"), { fish: 2 });
    assert.deepStrictEqual(await getQueueCounts("approval"), { fish: 1 });
    assert.strictEqual((await getQueue("witness", "fish")).length, 2);
  });

  void test("the SQL half and the predicate half agree", async () => {
    for (const state of EVERY_STATE) {
      await at(state);
    }

    for (const queue of ALL_QUEUES) {
      const fromSql = await query<Submission>(
        `SELECT * FROM submissions WHERE ${queueSql(queue, "submissions")}`
      );
      const fromPredicate = filterQueue(queue, await rows());

      // The SQL half is deliberately broader than the whole rule - it cannot
      // express the per-species waiting period - so it must be a superset.
      const sqlIds = new Set(filterQueue(queue, fromSql).map((s) => s.id));
      assert.deepStrictEqual(
        [...sqlIds].sort(),
        fromPredicate.map((s) => s.id).sort(),
        `${queue}: the SQL half must select everything the predicate keeps`
      );
    }
  });
});

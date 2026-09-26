import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  AuthorizationError,
  StateError,
  ValidationError,
  approve,
  bindSpecies,
  adoptSpeciesClassification,
  UnboundError,
  MismatchError,
  type Change,
  confirmWitness,
  correctPoints,
  createSubmission,
  deleteSubmission,
  deriveState,
  enterApprovalQueue,
  hasChangesRequested,
  queueFor,
  removeFromQueue,
  requestChanges,
  resetNotifier,
  resubmit,
  returnToDraft,
  saveChanges,
  saveDraft,
  submit,
  type Caller,
  type SubmissionState,
} from "@/lifecycle";
import { query } from "@/db/conn";
import { addName, checkFormAgreement, createSpecies, listNames } from "@/species";
import {
  mockApprovalData,
  ensureGuppySpecies,
  setupTestDatabase,
  teardownTestDatabase,
  type TestContext,
} from "./helpers/testHelpers";
import {
  readSubmission,
  recordNotifications,
  requestChangesFixture,
  submissionInState,
} from "./helpers/lifecycleFixtures";
import { assertSubmissionInvariantsHold } from "./helpers/assertInvariants";
import type { FormValues } from "@/forms/submission";

/**
 * The transition table, exercised through the module's interface.
 *
 * Every move is tried from every state, legal and not, and every refusal is
 * asserted to be the right kind: the wrong person, or the wrong moment.
 */

const ALL_STATES: SubmissionState[] = [
  "draft",
  "pendingWitness",
  "waitingPeriod",
  "awaitingFinalSubmission",
  "inApprovalQueue",
  "approved",
];

const form: FormValues = {
  species_type: "Fish",
  species_class: "Livebearers",
  species_common_name: "Guppy",
  species_latin_name: "Poecilia reticulata",
  water_type: "Fresh",
  count: "20",
  reproduction_date: "2024-01-01",
  foods: ["Flakes"],
  spawn_locations: ["Plants"],
  tank_size: "10",
  filter_type: "Sponge",
  water_change_volume: "50%",
  water_change_frequency: "Weekly",
  temperature: "75",
  ph: "7.0",
};

void describe("Submission lifecycle - transitions", () => {
  let ctx: TestContext;
  let member: Caller;
  let committee: Caller;
  let otherMember: Caller;

  beforeEach(async () => {
    ctx = await setupTestDatabase({ adminCount: 2 });
    recordNotifications();
    member = { id: ctx.member.id, isAdmin: false };
    committee = { id: ctx.admin.id, isAdmin: true };
    otherMember = { id: ctx.otherAdmin!.id, isAdmin: false };
  });

  afterEach(async () => {
    resetNotifier();
    await teardownTestDatabase(ctx);
  });

  /** Put one of the member's Submissions into `state`. */
  const at = (state: SubmissionState) =>
    submissionInState(ctx.db, state, {
      memberId: ctx.member.id,
      witnessedBy: ctx.admin.id,
    });

  const stateOf = async (id: number) => deriveState((await readSubmission(id))!);

  /**
   * The form as the member would resubmit it: the same content, with the
   * reproduction date the Submission already carries. Editing that date really
   * does move the clock, so a test about something else must not change it.
   */
  const formFor = async (id: number): Promise<FormValues> => ({
    ...form,
    reproduction_date: (await readSubmission(id))!.reproduction_date,
  });

  /** The kind of refusal a call produced, or "allowed" if it did not refuse. */
  async function refusal(call: () => Promise<unknown>): Promise<string> {
    try {
      await call();
      return "allowed";
    } catch (err) {
      if (err instanceof AuthorizationError) return "authorization";
      if (err instanceof StateError) return "state";
      if (err instanceof ValidationError) return "validation";
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Legality, state by state
  // -------------------------------------------------------------------------

  void describe("which states each move is legal from", () => {
    const cases: Array<{
      move: string;
      legal: SubmissionState[];
      run: (id: number) => Promise<unknown>;
    }> = [
      { move: "saveDraft", legal: ["draft"], run: (id) => saveDraft(member, id, form) },
      { move: "submit", legal: ["draft"], run: (id) => submit(member, id, form) },
      {
        move: "saveChanges",
        legal: ["pendingWitness", "waitingPeriod", "awaitingFinalSubmission", "inApprovalQueue"],
        run: (id) => saveChanges(member, id, form),
      },
      {
        move: "returnToDraft",
        legal: ["pendingWitness", "waitingPeriod", "awaitingFinalSubmission"],
        run: (id) => returnToDraft(member, id),
      },
      {
        move: "confirmWitness",
        legal: ["pendingWitness"],
        run: (id) => confirmWitness(committee, id),
      },
      {
        move: "enterApprovalQueue",
        legal: ["awaitingFinalSubmission"],
        run: (id) => enterApprovalQueue(member, id),
      },
      {
        move: "removeFromQueue",
        legal: ["inApprovalQueue"],
        run: (id) => removeFromQueue(member, id),
      },
      {
        move: "requestChanges",
        legal: ["pendingWitness", "waitingPeriod", "awaitingFinalSubmission", "inApprovalQueue"],
        run: (id) => requestChanges(committee, id, "Please add a photo"),
      },
      {
        move: "approve",
        legal: ["inApprovalQueue"],
        run: (id) => approve(committee, id, mockApprovalData),
      },
      {
        move: "correctPoints",
        legal: ["approved"],
        run: (id) => correctPoints(committee, id, { points: 15 }, "Miscounted"),
      },
    ];

    for (const { move, legal, run } of cases) {
      for (const state of ALL_STATES) {
        const expected = legal.includes(state) ? "allowed" : "state";
        void test(`${move} from ${state} is ${expected === "allowed" ? "legal" : "refused as the wrong moment"}`, async () => {
          const id = await at(state);
          assert.strictEqual(await refusal(() => run(id)), expected);
        });
      }
    }
  });

  void describe("Delete has a different table for each actor", () => {
    for (const state of ALL_STATES) {
      const memberMay = state === "draft";
      void test(`a member deleting their own ${state} submission is ${memberMay ? "allowed" : "refused"}`, async () => {
        const id = await at(state);
        assert.strictEqual(
          await refusal(() => deleteSubmission(member, id)),
          memberMay ? "allowed" : "state"
        );
      });

      const committeeMay = state !== "approved";
      void test(`the committee deleting a ${state} submission is ${committeeMay ? "allowed" : "refused"}`, async () => {
        const id = await at(state);
        assert.strictEqual(
          await refusal(() => deleteSubmission(committee, id)),
          committeeMay ? "allowed" : "state"
        );
      });
    }

    void test("deleting takes the Submission's child rows with it", async () => {
      const id = await at("draft");
      await ctx.db.run(
        `INSERT INTO submission_supplements (submission_id, supplement_type, supplement_regimen, display_order)
         VALUES (?, 'Iron', 'Weekly', 0)`,
        [id]
      );
      await ctx.db.run(
        `INSERT INTO submission_notes (submission_id, admin_id, note_text) VALUES (?, ?, 'a note')`,
        [id, ctx.admin.id]
      );

      await deleteSubmission(member, id);

      const supplements = await query("SELECT * FROM submission_supplements WHERE submission_id = ?", [id]);
      const notes = await query("SELECT * FROM submission_notes WHERE submission_id = ?", [id]);
      assert.strictEqual(supplements.length, 0, "supplements should go with the submission");
      assert.strictEqual(notes.length, 0, "notes should go with the submission");
    });
  });

  // -------------------------------------------------------------------------
  // The wrong person
  // -------------------------------------------------------------------------

  void describe("who may perform a move", () => {
    void test("a member cannot touch another member's Submission", async () => {
      const id = await at("waitingPeriod");
      assert.strictEqual(await refusal(() => saveChanges(otherMember, id, form)), "authorization");
      assert.strictEqual(await refusal(() => returnToDraft(otherMember, id)), "authorization");
      assert.strictEqual(await refusal(() => deleteSubmission(otherMember, id)), "authorization");
    });

    void test("a committee member does not type into another member's Submission", async () => {
      // The committee changes a Submission by asking for changes, not by
      // editing it. The one exception is a correction to an Approved one,
      // which carries a stated reason and goes on the record.
      const draft = await at("draft");
      assert.strictEqual(await refusal(() => saveDraft(committee, draft, form)), "authorization");
      assert.strictEqual(await refusal(() => submit(committee, draft, form)), "authorization");

      const inFlight = await at("waitingPeriod");
      assert.strictEqual(
        await refusal(() => saveChanges(committee, inFlight, form)),
        "authorization"
      );
      assert.strictEqual(await refusal(() => resubmit(committee, inFlight, form)), "authorization");
      assert.strictEqual(await refusal(() => returnToDraft(committee, inFlight)), "authorization");
    });

    void test("a member cannot perform a committee move", async () => {
      const id = await at("pendingWitness");
      assert.strictEqual(await refusal(() => confirmWitness(otherMember, id)), "authorization");
      assert.strictEqual(
        await refusal(() => requestChanges(otherMember, id, "nope")),
        "authorization"
      );
    });

    void test("a committee member cannot witness their own Submission", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", { memberId: ctx.admin.id });
      assert.strictEqual(await refusal(() => confirmWitness(committee, id)), "authorization");
    });

    void test("refusing a committee member their own Submission says why", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", { memberId: ctx.admin.id });
      await assert.rejects(
        () => confirmWitness(committee, id),
        (err: Error) => {
          assert.ok(err instanceof AuthorizationError);
          // Not "only the committee may do this" - they are the committee.
          assert.match(err.message, /your own submission/);
          return true;
        }
      );
    });

    void test("a committee member cannot approve their own Submission", async () => {
      const id = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.admin.id,
        witnessedBy: ctx.otherAdmin!.id,
      });
      assert.strictEqual(
        await refusal(() => approve(committee, id, mockApprovalData)),
        "authorization"
      );
    });

    void test("a committee member walks their own work back like anyone else", async () => {
      const id = await submissionInState(ctx.db, "waitingPeriod", {
        memberId: ctx.admin.id,
        witnessedBy: ctx.otherAdmin!.id,
      });
      // Their own Submission is not in the approval queue, so Delete is not
      // theirs to reach for - they return it to Draft first.
      assert.strictEqual(await refusal(() => deleteSubmission(committee, id)), "state");
      await returnToDraft(committee, id);
      assert.strictEqual(await stateOf(id), "draft");
      await deleteSubmission(committee, id);
      assert.strictEqual(await readSubmission(id), undefined);
    });

    void test("a member may queue their own Submission, and so may the committee", async () => {
      const mine = await at("awaitingFinalSubmission");
      await enterApprovalQueue(member, mine);
      assert.strictEqual(await stateOf(mine), "inApprovalQueue");

      const onBehalf = await at("awaitingFinalSubmission");
      await enterApprovalQueue(committee, onBehalf);
      assert.strictEqual(await stateOf(onBehalf), "inApprovalQueue");
    });
  });

  // -------------------------------------------------------------------------
  // While changes are outstanding, the ball is with the member
  // -------------------------------------------------------------------------

  void describe("the Changes requested overlay", () => {
    void test("no committee move but Delete is legal while changes are outstanding", async () => {
      const pending = await at("pendingWitness");
      await requestChangesFixture(pending, ctx.admin.id);
      assert.strictEqual(await refusal(() => confirmWitness(committee, pending)), "state");
      assert.strictEqual(
        await refusal(() => requestChanges(committee, pending, "again")),
        "state"
      );

      const queued = await at("inApprovalQueue");
      await requestChangesFixture(queued, ctx.admin.id);
      assert.strictEqual(
        await refusal(() => approve(committee, queued, mockApprovalData)),
        "state"
      );
      assert.strictEqual(await refusal(() => deleteSubmission(committee, queued)), "allowed");
    });

    void test("nothing enters the approval queue while changes are outstanding", async () => {
      const id = await at("awaitingFinalSubmission");
      await requestChangesFixture(id, ctx.admin.id);
      assert.strictEqual(await refusal(() => enterApprovalQueue(member, id)), "state");
    });

    void test("resubmitting clears the flag and keeps an unwitnessed Submission where it was", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", { memberId: ctx.member.id });
      const before = (await readSubmission(id))!;
      await requestChangesFixture(id, ctx.admin.id);

      await resubmit(member, id, await formFor(id));

      const after = (await readSubmission(id))!;
      assert.strictEqual(hasChangesRequested(after), false);
      assert.strictEqual(deriveState(after), "pendingWitness");
      assert.strictEqual(after.submitted_on, before.submitted_on, "keeps its place in the queue");
      await assertSubmissionInvariantsHold(after);
    });

    void test("resubmitting a witnessed Submission sends it back through witnessing", async () => {
      const id = await at("inApprovalQueue");
      const before = (await readSubmission(id))!;
      await requestChangesFixture(id, ctx.admin.id);

      await resubmit(member, id, await formFor(id));

      const after = (await readSubmission(id))!;
      assert.strictEqual(hasChangesRequested(after), false);
      assert.strictEqual(deriveState(after), "pendingWitness");
      assert.strictEqual(queueFor(after), "witness");
      assert.strictEqual(after.witnessed_by, null);
      assert.strictEqual(after.final_submission_on, null);
      assert.strictEqual(after.submitted_on, before.submitted_on, "keeps its submission date");
      await assertSubmissionInvariantsHold(after);
    });

    void test("resubmitting is refused when the committee has asked for nothing", async () => {
      const id = await at("waitingPeriod");
      assert.strictEqual(await refusal(() => resubmit(member, id, form)), "state");
    });

    void test("requesting changes needs the problems stated", async () => {
      const id = await at("waitingPeriod");
      assert.strictEqual(await refusal(() => requestChanges(committee, id, "   ")), "validation");
    });
  });

  // -------------------------------------------------------------------------
  // Editing no longer moves a Submission
  // -------------------------------------------------------------------------

  void describe("Save Changes voids a confirmed Witness", () => {
    void test("editing a Submission awaiting a Witness keeps its state and date", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", { memberId: ctx.member.id });
      const before = (await readSubmission(id))!;

      await saveChanges(member, id, { ...(await formFor(id)), count: "40" });

      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "pendingWitness");
      assert.strictEqual(after.submitted_on, before.submitted_on);
      assert.strictEqual(after.count, "40", "the edit itself landed");
      await assertSubmissionInvariantsHold(after);
    });

    for (const state of [
      "waitingPeriod",
      "awaitingFinalSubmission",
      "inApprovalQueue",
    ] as SubmissionState[]) {
      void test(`editing a witnessed ${state} Submission sends it back to the witness queue`, async () => {
        const id = await at(state);
        const before = (await readSubmission(id))!;

        await saveChanges(member, id, { ...(await formFor(id)), count: "40" });

        const after = (await readSubmission(id))!;
        assert.strictEqual(deriveState(after), "pendingWitness");
        assert.strictEqual(queueFor(after), "witness");
        assert.strictEqual(after.witness_verification_status, "pending");
        assert.strictEqual(after.witnessed_by, null);
        assert.strictEqual(after.witnessed_on, null);
        assert.strictEqual(after.final_submission_on, null, "it must be witnessed before it queues");
        assert.strictEqual(after.submitted_on, before.submitted_on, "keeps its submission date");
        assert.strictEqual(after.count, "40", "the edit itself landed");
        await assertSubmissionInvariantsHold(after);
      });
    }

    void test("a save that changes nothing still voids the Witness", async () => {
      // ADR-0001: one rule, no field list. The Portal does not diff the form
      // against what the Witness saw; saving is the member's edit.
      const id = await at("waitingPeriod");

      await saveChanges(member, id, await formFor(id));

      assert.strictEqual(await stateOf(id), "pendingWitness");
    });

    void test("a voided Submission can be witnessed again", async () => {
      const id = await at("waitingPeriod");
      await saveChanges(member, id, { ...(await formFor(id)), count: "40" });

      await confirmWitness(committee, id);

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.witness_verification_status, "confirmed");
      assert.strictEqual(after.witnessed_by, ctx.admin.id);
      await assertSubmissionInvariantsHold(after);
    });
  });

  // -------------------------------------------------------------------------
  // Leaving Draft
  // -------------------------------------------------------------------------

  void describe("Leaving Draft", () => {
    void test("a first submission awaits a Witness", async () => {
      const id = await createSubmission(member, ctx.member.id, form, { submit: false });
      assert.strictEqual(await stateOf(id), "draft");

      await submit(member, id, form);

      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "pendingWitness");
      assert.strictEqual(after.witness_verification_status, "pending");
    });

    void test("Return to Draft then resubmit voids a confirmed Witness", async () => {
      const id = await at("waitingPeriod");
      const witnessedBy = (await readSubmission(id))!.witnessed_by;

      await returnToDraft(member, id);
      const drafted = (await readSubmission(id))!;
      assert.strictEqual(deriveState(drafted), "draft");
      assert.strictEqual(
        drafted.witnessed_by,
        witnessedBy,
        "withdrawing is not an edit; the Witness goes when the member saves"
      );

      await submit(member, id, await formFor(id));
      const resubmitted = (await readSubmission(id))!;
      assert.strictEqual(deriveState(resubmitted), "pendingWitness");
      assert.strictEqual(queueFor(resubmitted), "witness");
      assert.strictEqual(resubmitted.witness_verification_status, "pending");
      assert.strictEqual(resubmitted.witnessed_by, null);
      assert.strictEqual(resubmitted.witnessed_on, null);
      await assertSubmissionInvariantsHold(resubmitted);
    });

    void test("Return to Draft takes the Submission out of the approval queue's reach", async () => {
      const id = await at("awaitingFinalSubmission");
      await returnToDraft(member, id);
      assert.strictEqual(await refusal(() => enterApprovalQueue(member, id)), "state");
    });

    void test("submitting answers an outstanding request for changes", async () => {
      const id = await at("waitingPeriod");
      await requestChangesFixture(id, ctx.admin.id);
      await returnToDraft(member, id);
      assert.strictEqual(hasChangesRequested((await readSubmission(id))!), true);

      await submit(member, id, await formFor(id));

      const after = (await readSubmission(id))!;
      assert.strictEqual(
        hasChangesRequested(after),
        false,
        "work arriving in a committee queue must not also be marked as waiting on the member"
      );
    });
  });

  // -------------------------------------------------------------------------
  // The Witness
  // -------------------------------------------------------------------------

  void describe("the Witness gate", () => {
    void test("confirming is refused on a Submission bound to no Species, with its own refusal", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesId: null,
      });

      await assert.rejects(
        () => confirmWitness(committee, id),
        (err: unknown) =>
          err instanceof UnboundError &&
          err.message === "Bind this Submission to a Species before you confirm its Witness" &&
          !(err instanceof StateError)
      );
      assert.strictEqual(await stateOf(id), "pendingWitness");
    });

    void test("confirming starts the waiting period", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        reproductionDate: new Date().toISOString(),
      });

      await confirmWitness(committee, id);

      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "waitingPeriod");
      assert.strictEqual(after.witnessed_by, ctx.admin.id);
      assert.ok(after.witnessed_on);
      await assertSubmissionInvariantsHold(after);
    });

    void test("two committee members confirming at once: exactly one wins", async () => {
      const id = await at("pendingWitness");

      const results = await Promise.allSettled([
        confirmWitness(committee, id),
        confirmWitness({ id: ctx.otherAdmin!.id, isAdmin: true }, id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.strictEqual(fulfilled.length, 1, "one confirmation, not two");
      assert.strictEqual(rejected.length, 1);
      assert.ok(
        rejected[0].reason instanceof StateError,
        `the loser is refused by the table, not by the driver: ${String(rejected[0].reason)}`
      );
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "confirmed");
    });

    void test("confirming against a simultaneous request for changes leaves one winner", async () => {
      const id = await at("pendingWitness");

      await Promise.allSettled([
        confirmWitness(committee, id),
        requestChanges({ id: ctx.otherAdmin!.id, isAdmin: true }, id, "More photos please"),
      ]);

      const after = (await readSubmission(id))!;
      // Confirming a Witness while changes are outstanding is exactly the rule
      // the prototype turned up, so whichever landed first must win: a Witness
      // may precede a request for changes, never follow one.
      if (after.changes_requested_on && after.witnessed_on) {
        assert.ok(
          new Date(after.witnessed_on) <= new Date(after.changes_requested_on),
          "a Witness must not be confirmed after the committee asked for changes"
        );
      }
      await assertSubmissionInvariantsHold(after);
    });

    void test("only a member's save voids a confirmed Witness", async () => {
      const id = await createSubmission(member, ctx.member.id, form, { submit: true });
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "pending");

      await bindSpecies(committee, id, await ensureGuppySpecies(ctx.db));
      await confirmWitness(committee, id);
      await requestChanges(committee, id, "Add a photo of the fry");
      assert.strictEqual(
        (await readSubmission(id))!.witness_verification_status,
        "confirmed",
        "the committee asking for changes does not discard its own inspection"
      );

      await resubmit(member, id, { ...form, count: "99" });

      assert.strictEqual(
        (await readSubmission(id))!.witness_verification_status,
        "pending",
        "the Witness attested to the form, so the member's edit voids it"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Binding a Species
  // -------------------------------------------------------------------------

  void describe("Binding a Species", () => {
    const newSpecies = (epithet: string) =>
      createSpecies({
        canonicalGenus: "Bindus",
        canonicalSpeciesName: epithet,
        programClass: "Livebearers",
        speciesType: "Fish",
      });
    const changelog = async (id: number) =>
      (
        await query<{ note_text: string }>(
          "SELECT note_text FROM submission_notes WHERE submission_id = ? ORDER BY id",
          [id]
        )
      ).map((n) => JSON.parse(n.note_text) as { type: string; changes: Change[]; reason: string });

    void test("the witness binds an unbound Submission, then rebinds it; both go on the changelog", async () => {
      const first = await newSpecies("primus");
      const second = await newSpecies("secundus");
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesId: null,
      });

      await bindSpecies(committee, id, first);
      assert.strictEqual((await readSubmission(id))!.species_id, first);
      await bindSpecies(committee, id, second);
      assert.strictEqual((await readSubmission(id))!.species_id, second);
      await bindSpecies(committee, id, second);

      assert.deepStrictEqual(
        (await changelog(id)).map((e) => [e.type, e.changes]),
        [
          ["admin_edit", [{ field: "species", old: null, new: "Bindus primus" }]],
          ["admin_edit", [{ field: "species", old: "Bindus primus", new: "Bindus secundus" }]],
        ],
        "binding to the Species it already has records nothing"
      );

      await confirmWitness(committee, id);
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "confirmed");
    });

    void test("rebinding a witnessed Submission is the committee's move and keeps the Witness", async () => {
      const id = await at("waitingPeriod");
      await bindSpecies(committee, id, await newSpecies("tertius"));

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.witness_verification_status, "confirmed");
      assert.strictEqual(deriveState(after), "waitingPeriod");
    });

    void test("only the committee binds, never on its own Submission, and not once Approved or a Draft", async () => {
      const speciesId = await newSpecies("quartus");
      const pending = await at("pendingWitness");
      const approved = await at("approved");
      const draft = await at("draft");
      assert.strictEqual(await refusal(() => bindSpecies(member, pending, speciesId)), "authorization");

      const own = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.admin.id,
        speciesId: null,
      });
      assert.strictEqual(await refusal(() => bindSpecies(committee, own, speciesId)), "authorization");

      assert.strictEqual(await refusal(() => bindSpecies(committee, approved, speciesId)), "state");
      assert.strictEqual(await refusal(() => bindSpecies(committee, draft, speciesId)), "state");
    });

    void test("while changes are requested, neither binding nor adopting is the committee's to do", async () => {
      const id = await at("pendingWitness");
      await requestChanges(committee, id, "Check the Species");
      const speciesId = await newSpecies("quintus");

      assert.strictEqual(await refusal(() => bindSpecies(committee, id, speciesId)), "state");
      assert.strictEqual(await refusal(() => adoptSpeciesClassification(committee, id)), "state");
    });

    void test("binding to a Species that does not exist is refused", async () => {
      const id = await at("pendingWitness");
      assert.strictEqual(await refusal(() => bindSpecies(committee, id, 987654)), "validation");
      assert.strictEqual((await readSubmission(id))!.species_id, await ensureGuppySpecies(ctx.db));
    });
  });

  // -------------------------------------------------------------------------
  // Agreement with the Species (CONTEXT.md, Bound)
  // -------------------------------------------------------------------------

  void describe("Agreement with the Species", () => {
    const speciesIdOf = async (id: number) => (await readSubmission(id))!.species_id;
    const inRefusal = async (call: () => Promise<unknown>) => {
      try {
        await call();
        return "allowed";
      } catch (err) {
        if (err instanceof MismatchError) return "mismatch";
        if (err instanceof UnboundError) return "unbound";
        throw err;
      }
    };

    void test("saving a bound Submission with a changed Species type clears the binding", async () => {
      const id = await at("pendingWitness");
      assert.ok(await speciesIdOf(id));

      await saveChanges(member, id, { ...(await formFor(id)), species_type: "Invert" });

      assert.strictEqual(await speciesIdOf(id), null);
    });

    void test("a changed Program class, or a Latin spelling that is not a Name, clears it too", async () => {
      const classChanged = await at("pendingWitness");
      await saveChanges(member, classChanged, { ...(await formFor(classChanged)), species_class: "Killifish" });
      assert.strictEqual(await speciesIdOf(classChanged), null);

      const misspelled = await at("pendingWitness");
      await saveChanges(member, misspelled, {
        ...(await formFor(misspelled)),
        species_latin_name: "Poecilia reticulatta",
      });
      assert.strictEqual(await speciesIdOf(misspelled), null, "a spelling-only disagreement is a disagreement");
    });

    void test("a save that still agrees keeps the binding", async () => {
      const id = await at("pendingWitness");
      const bound = await speciesIdOf(id);

      // Names match whatever the case, and a blank spelling agrees
      await saveChanges(member, id, {
        ...(await formFor(id)),
        species_common_name: "GUPPY",
        species_latin_name: "poecilia reticulata",
        count: "35",
      });
      assert.strictEqual(await speciesIdOf(id), bound);
    });

    void test("every member save applies it: Save Draft, Submit and Resubmit as well", async () => {
      const disagreeing = (f: FormValues): FormValues => ({ ...f, species_type: "Invert" });

      const draft = await at("draft");
      await ctx.db.run("UPDATE submissions SET species_id = ? WHERE id = ?", [await ensureGuppySpecies(ctx.db), draft]);
      await saveDraft(member, draft, disagreeing(await formFor(draft)));
      assert.strictEqual(await speciesIdOf(draft), null, "Save Draft");

      const toSubmit = await at("draft");
      await ctx.db.run("UPDATE submissions SET species_id = ? WHERE id = ?", [
        await ensureGuppySpecies(ctx.db),
        toSubmit,
      ]);
      await submit(member, toSubmit, disagreeing(await formFor(toSubmit)));
      assert.strictEqual(await speciesIdOf(toSubmit), null, "Submit");

      const asked = await at("pendingWitness");
      await requestChanges(committee, asked, "Check the type");
      assert.ok(await speciesIdOf(asked), "a committee move never unbinds");
      await resubmit(member, asked, disagreeing(await formFor(asked)));
      assert.strictEqual(await speciesIdOf(asked), null, "Resubmit");
    });

    void test("confirming is refused on a Program class mismatch, with its own refusal", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesClass: "Cichlids - New World",
      });

      assert.strictEqual(await inRefusal(() => confirmWitness(committee, id)), "mismatch");
      await assert.rejects(
        () => confirmWitness(committee, id),
        (err: unknown) => err instanceof MismatchError && !(err instanceof StateError)
      );
      assert.strictEqual(await stateOf(id), "pendingWitness");
    });

    void test("a spelling that is not a Name does not block confirming", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        latinName: "Poecilia reticulatta",
        commonName: "Millions fish",
      });

      await confirmWitness(committee, id);
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "confirmed");
    });

    void test("adopting the Species' values sets the type, class and Program, clears the mismatch, and is on the changelog", async () => {
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesType: "Invert",
        speciesClass: "Shrimp",
      });
      assert.strictEqual(await inRefusal(() => confirmWitness(committee, id)), "mismatch");

      await adoptSpeciesClassification(committee, id);

      const after = (await readSubmission(id))!;
      assert.deepStrictEqual([after.species_type, after.species_class, after.program], [
        "Fish",
        "Livebearers",
        "fish",
      ]);
      const notes = await query<{ note_text: string }>(
        "SELECT note_text FROM submission_notes WHERE submission_id = ?",
        [id]
      );
      assert.deepStrictEqual(
        (JSON.parse(notes[0].note_text) as { changes: Change[] }).changes.map((c) => [c.field, c.old, c.new]),
        [
          ["species_type", "Invert", "Fish"],
          ["species_class", "Shrimp", "Livebearers"],
        ]
      );

      await adoptSpeciesClassification(committee, id);
      assert.strictEqual(
        (await query("SELECT id FROM submission_notes WHERE submission_id = ?", [id])).length,
        1,
        "adopting values it already has records nothing"
      );

      await confirmWitness(committee, id);
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "confirmed");
    });

    void test("adopting keeps a confirmed Witness, and is the committee's move on someone else's bound Submission", async () => {
      const witnessed = await submissionInState(ctx.db, "waitingPeriod", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        speciesClass: "Killifish",
      });
      await adoptSpeciesClassification(committee, witnessed);
      assert.strictEqual((await readSubmission(witnessed))!.witness_verification_status, "confirmed");

      assert.strictEqual(await refusal(() => adoptSpeciesClassification(member, witnessed)), "authorization");
      const own = await submissionInState(ctx.db, "pendingWitness", { memberId: ctx.admin.id });
      assert.strictEqual(await refusal(() => adoptSpeciesClassification(committee, own)), "authorization");
      const unbound = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesId: null,
      });
      assert.strictEqual(await inRefusal(() => adoptSpeciesClassification(committee, unbound)), "unbound");
    });

    void test("adopting a classification with a longer waiting period takes a queued Submission back out of the queue", async () => {
      // Queued as Fish/Marine (30 days) at 40 days old; Guppy is Fish/Livebearers (60 days)
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const id = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.member.id,
        speciesType: "Fish",
        speciesClass: "Marine",
        reproductionDate: fortyDaysAgo,
      });

      await adoptSpeciesClassification(committee, id);

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.species_class, "Livebearers");
      assert.strictEqual(after.final_submission_on, null);
      assert.strictEqual(deriveState(after), "waitingPeriod");
      assert.strictEqual(await refusal(() => approve(committee, id, mockApprovalData)), "state");
      const notes = await query<{ note_text: string }>(
        "SELECT note_text FROM submission_notes WHERE submission_id = ?",
        [id]
      );
      assert.ok(
        (JSON.parse(notes[0].note_text) as { changes: Change[] }).changes.some((c) => c.field === "final_submission_on"),
        "leaving the queue is on the changelog"
      );

      // A queued Submission whose new clock has already run stays queued
      const served = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.member.id,
        speciesType: "Fish",
        speciesClass: "Marine",
      });
      await adoptSpeciesClassification(committee, served);
      assert.strictEqual(deriveState((await readSubmission(served))!), "inApprovalQueue");
    });
  });

  // -------------------------------------------------------------------------
  // The member's pick binds at submit (CONTEXT.md, Bound)
  // -------------------------------------------------------------------------

  void describe("The member's pick binds", () => {
    const speciesIdOf = async (id: number) => (await readSubmission(id))!.species_id;
    /** The form after picking Guppy in the typeahead: its id, type and class. */
    const picked = async (): Promise<FormValues> => ({ ...form, species_id: await ensureGuppySpecies(ctx.db) });

    void test("submitting with a picked Name produces a bound Submission with the Species' type and class", async () => {
      const guppy = await ensureGuppySpecies(ctx.db);
      const id = await createSubmission(member, ctx.member.id, await picked(), { submit: true });

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.species_id, guppy);
      assert.deepStrictEqual([after.species_type, after.species_class], ["Fish", "Livebearers"]);
    });

    void test("a picked Name binds a Draft too, and Submit keeps it", async () => {
      const guppy = await ensureGuppySpecies(ctx.db);
      const id = await createSubmission(member, ctx.member.id, await picked(), { submit: false });
      assert.strictEqual(await speciesIdOf(id), guppy);

      await submit(member, id, await picked());
      assert.strictEqual(await speciesIdOf(id), guppy);
    });

    void test("picking a Species with no common Names binds, with its Latin name as the common name", async () => {
      const speciesId = await createSpecies({
        canonicalGenus: "Nocommonus",
        canonicalSpeciesName: "latinus",
        programClass: "Livebearers",
        speciesType: "Fish",
      });
      // What the submit form sends after the pick: the Latin spelling in both fields
      const pickedForm = {
        ...form,
        species_common_name: "Nocommonus latinus",
        species_latin_name: "Nocommonus latinus",
        species_id: speciesId,
      };

      const draft = await createSubmission(member, ctx.member.id, pickedForm, { submit: false });
      assert.strictEqual(await speciesIdOf(draft), speciesId);
      await saveDraft(member, draft, pickedForm);
      assert.strictEqual(await speciesIdOf(draft), speciesId, "the binding survives the save");
    });

    void test("submitting free text produces an unbound Submission", async () => {
      await ensureGuppySpecies(ctx.db);
      const id = await createSubmission(
        member,
        ctx.member.id,
        { ...form, species_common_name: "Mystery tetra", species_latin_name: "Hyphessobrycon ignotus" },
        { submit: true }
      );
      assert.strictEqual(await speciesIdOf(id), null);

      // Even text that happens to be a Name: binding is by picking
      const typed = await createSubmission(member, ctx.member.id, form, { submit: true });
      assert.strictEqual(await speciesIdOf(typed), null);
    });

    void test("picking, then changing the class, then saving produces an unbound Submission", async () => {
      const changedAtCreate = await createSubmission(
        member,
        ctx.member.id,
        { ...(await picked()), species_class: "Killifish" },
        { submit: true }
      );
      assert.strictEqual(await speciesIdOf(changedAtCreate), null);

      const draft = await createSubmission(member, ctx.member.id, await picked(), { submit: false });
      await saveDraft(member, draft, { ...(await picked()), species_class: "Killifish" });
      assert.strictEqual(await speciesIdOf(draft), null);
    });

    void test("a forged id whose Species disagrees with the form is not kept", async () => {
      const other = await createSpecies({
        canonicalGenus: "Forgus",
        canonicalSpeciesName: "falsus",
        programClass: "Killifish",
        speciesType: "Fish",
      });
      const created = await createSubmission(member, ctx.member.id, { ...form, species_id: other }, { submit: true });
      assert.strictEqual(await speciesIdOf(created), null);

      // Nor on an edit, where it replaces an agreeing binding with none
      const bound = await at("pendingWitness");
      await saveChanges(member, bound, { ...(await formFor(bound)), species_id: other });
      assert.strictEqual(await speciesIdOf(bound), null);
    });

    void test("an id that names no Species saves unbound, not an error", async () => {
      const created = await createSubmission(member, ctx.member.id, { ...form, species_id: 987654 }, { submit: true });
      assert.strictEqual(await speciesIdOf(created), null);

      const bound = await at("pendingWitness");
      await saveChanges(member, bound, { ...(await formFor(bound)), species_id: 987654 });
      assert.strictEqual(await speciesIdOf(bound), null);
    });

    void test("picking on the edit form binds an unbound Submission; the save still voids the Witness", async () => {
      const guppy = await ensureGuppySpecies(ctx.db);
      const id = await submissionInState(ctx.db, "waitingPeriod", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        speciesId: null,
      });

      await saveChanges(member, id, { ...(await formFor(id)), species_id: guppy });

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.species_id, guppy);
      assert.strictEqual(after.witness_verification_status, "pending", "ADR-0001: any member save voids it");
    });

    void test("the witness finds a member-bound Submission bound, its picked spellings already Names", async () => {
      const guppy = await ensureGuppySpecies(ctx.db);
      const id = await createSubmission(member, ctx.member.id, await picked(), { submit: true });

      const agreement = (await checkFormAgreement(guppy, (await readSubmission(id))!))!;
      assert.deepStrictEqual([agreement.commonName, agreement.latinName, agreement.agrees], ["name", "name", true]);

      await confirmWitness(committee, id, { common: true, scientific: true });
      assert.strictEqual((await readSubmission(id))!.witness_verification_status, "confirmed");
      const names = await listNames(guppy);
      assert.deepStrictEqual(names.common.map((n) => n.name), ["Guppy"], "a picked Name is never added again");
      assert.deepStrictEqual(names.scientific.map((n) => n.name), ["Poecilia reticulata"]);
    });
  });

  // -------------------------------------------------------------------------
  // Names minted at the Witness
  // -------------------------------------------------------------------------

  void describe("Names the witness adds when confirming", () => {
    /** A pending Submission bound to a fresh Species with only its Canonical name. */
    const pendingOn = async (spellings: { commonName: string; latinName: string }) => {
      const speciesId = await createSpecies({
        canonicalGenus: "Mintus",
        canonicalSpeciesName: `species${Math.random().toString(36).slice(2, 8)}`,
        programClass: "Livebearers",
        speciesType: "Fish",
      });
      const id = await submissionInState(ctx.db, "pendingWitness", {
        memberId: ctx.member.id,
        speciesId,
        ...spellings,
      });
      return { id, speciesId };
    };
    const namesOf = async (speciesId: number) => {
      const names = await listNames(speciesId);
      return {
        common: names.common.map((n) => n.name),
        scientific: names.scientific.filter((n) => !n.canonical).map((n) => [n.name, n.canonical]),
      };
    };

    void test("the common spelling checked adds a common Name; unchecked adds nothing", async () => {
      const checked = await pendingOn({ commonName: " Sunset Mint ", latinName: "Mintus oldus" });
      await confirmWitness(committee, checked.id, { common: true });
      assert.deepStrictEqual(await namesOf(checked.speciesId), { common: ["Sunset Mint"], scientific: [] });

      const unchecked = await pendingOn({ commonName: "Dawn Mint", latinName: "Mintus olderus" });
      await confirmWitness(committee, unchecked.id, {});
      assert.deepStrictEqual(await namesOf(unchecked.speciesId), { common: [], scientific: [] });

      // No choice given: nothing added
      const unasked = await pendingOn({ commonName: "Noon Mint", latinName: "Mintus meridianus" });
      await confirmWitness(committee, unasked.id);
      assert.deepStrictEqual(await namesOf(unasked.speciesId), { common: [], scientific: [] });
    });

    void test("the Latin spelling checked adds an unflagged scientific Name", async () => {
      const { id, speciesId } = await pendingOn({ commonName: "Latin Mint", latinName: "Mintus antiquus" });
      await confirmWitness(committee, id, { common: false, scientific: true });

      assert.deepStrictEqual(await namesOf(speciesId), {
        common: [],
        scientific: [["Mintus antiquus", false]],
      });
    });

    void test("a spelling already a Name, in any case, is never added again", async () => {
      const { id, speciesId } = await pendingOn({ commonName: "twice mint", latinName: "Mintus iterum" });
      await addName(speciesId, "common", "Twice Mint");
      const canonical = (await listNames(speciesId)).scientific[0].name;
      await ctx.db.run("UPDATE submissions SET species_latin_name = ? WHERE id = ?", [canonical.toUpperCase(), id]);

      await confirmWitness(committee, id, { common: true, scientific: true });

      const names = await listNames(speciesId);
      assert.deepStrictEqual(names.common.map((n) => n.name), ["Twice Mint"]);
      assert.deepStrictEqual(names.scientific.map((n) => n.name), [canonical]);
    });

    void test("a refused confirmation adds no Name", async () => {
      const { id, speciesId } = await pendingOn({ commonName: "Refused Mint", latinName: "Mintus negatus" });
      await ctx.db.run("UPDATE submissions SET species_class = 'Killifish' WHERE id = ?", [id]);

      await assert.rejects(() => confirmWitness(committee, id, { common: true, scientific: true }), MismatchError);
      assert.deepStrictEqual(await namesOf(speciesId), { common: [], scientific: [] });
    });

    void test("a Latin spelling added as a Name then agrees with the Species", async () => {
      const { id, speciesId } = await pendingOn({ commonName: "Agree Mint", latinName: "Mintus concordans" });
      assert.strictEqual((await checkFormAgreement(speciesId, (await readSubmission(id))!))?.latinName, "not-a-name");

      await confirmWitness(committee, id, { scientific: true });
      assert.strictEqual((await checkFormAgreement(speciesId, (await readSubmission(id))!))?.latinName, "name");
    });
  });

  // -------------------------------------------------------------------------
  // Approval and correction
  // -------------------------------------------------------------------------

  void describe("Approve and Correct the Points", () => {
    void test("approving records the Points and is terminal", async () => {
      const id = await at("inApprovalQueue");

      await approve(committee, id, { ...mockApprovalData, points: 15 });

      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "approved");
      assert.strictEqual(after.points, 15);
      assert.strictEqual(after.approved_by, ctx.admin.id);
      await assertSubmissionInvariantsHold(after);

      assert.strictEqual(await refusal(() => returnToDraft(member, id)), "state");
      assert.strictEqual(await refusal(() => deleteSubmission(committee, id)), "state");
      assert.strictEqual(await refusal(() => deleteSubmission(member, id)), "state");
    });

    void test("approving keeps the bound Species and adds it no Names", async () => {
      const speciesId = await createSpecies({
        canonicalGenus: "Bindus",
        canonicalSpeciesName: "approvus",
        programClass: "Livebearers",
        speciesType: "Fish",
      });
      const before = await listNames(speciesId);
      const id = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        commonName: "Member's Own Spelling",
        latinName: "Bindus approvvus",
        speciesId,
      });

      await approve(committee, id, mockApprovalData);

      const after = (await readSubmission(id))!;
      assert.strictEqual(after.species_id, speciesId);
      assert.strictEqual(after.species_common_name, "Member's Own Spelling", "kept as submitted");
      assert.strictEqual(after.species_latin_name, "Bindus approvvus", "kept as submitted");
      assert.deepStrictEqual(await listNames(speciesId), before, "the member's spellings are not minted as Names");
    });

    void test("approving is refused on a Submission bound to no Species, with its own refusal", async () => {
      const id = await submissionInState(ctx.db, "inApprovalQueue", {
        memberId: ctx.member.id,
        witnessedBy: ctx.admin.id,
        speciesId: null,
      });

      await assert.rejects(
        () => approve(committee, id, mockApprovalData),
        (err: unknown) =>
          err instanceof UnboundError &&
          err.message === "Bind this Submission to a Species before you approve it" &&
          !(err instanceof StateError)
      );
      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "inApprovalQueue");
      assert.strictEqual(after.points, null, "no Points awarded to no Species");
    });

    void test("a correction needs a stated reason and an actual change", async () => {
      const id = await at("approved");
      assert.strictEqual(
        await refusal(() => correctPoints(committee, id, { points: 20 }, "  ")),
        "validation"
      );

      const current = (await readSubmission(id))!.points;
      assert.strictEqual(
        await refusal(() => correctPoints(committee, id, { points: current }, "no-op")),
        "validation"
      );
    });

    void test("a correction records what changed in the changelog", async () => {
      const id = await at("approved");

      const changes = await correctPoints(
        committee,
        id,
        { points: 20, species_latin_name: "Poecilia wingei" },
        "Misidentified species"
      );

      assert.deepStrictEqual(
        changes.map((c) => c.field).sort(),
        ["points", "species_latin_name"]
      );

      const notes = await query<{ note_text: string }>(
        "SELECT note_text FROM submission_notes WHERE submission_id = ?",
        [id]
      );
      assert.strictEqual(notes.length, 1);
      assert.match(notes[0].note_text, /Misidentified species/);
      assert.strictEqual((await readSubmission(id))!.points, 20);
    });

    void test("a Points correction leaves the Witness untouched", async () => {
      const id = await at("approved");
      const before = (await readSubmission(id))!;

      await correctPoints(committee, id, { points: 20 }, "Miscounted");

      const after = (await readSubmission(id))!;
      assert.strictEqual(deriveState(after), "approved");
      assert.strictEqual(after.witness_verification_status, "confirmed");
      assert.strictEqual(after.witnessed_by, before.witnessed_by);
      assert.strictEqual(after.witnessed_on, before.witnessed_on);
      assert.strictEqual(after.final_submission_on, before.final_submission_on);
      await assertSubmissionInvariantsHold(after);
    });
  });

  // -------------------------------------------------------------------------
  // Things that are not there
  // -------------------------------------------------------------------------

  void describe("refusals name what was wrong", () => {
    void test("a Submission that does not exist is a validation refusal", async () => {
      assert.strictEqual(await refusal(() => saveChanges(member, 999999, form)), "validation");
      assert.strictEqual(await refusal(() => confirmWitness(committee, 999999)), "validation");
      assert.strictEqual(await refusal(() => deleteSubmission(committee, 999999)), "validation");
    });

    void test("a member cannot file on somebody else's behalf", async () => {
      assert.strictEqual(
        await refusal(() =>
          createSubmission(member, ctx.otherAdmin!.id, form, { submit: true })
        ),
        "authorization"
      );
    });

    void test("a committee member may file on a member's behalf", async () => {
      const id = await createSubmission(committee, ctx.member.id, form, { submit: true });
      const created = (await readSubmission(id))!;
      assert.strictEqual(created.member_id, ctx.member.id);
      assert.strictEqual(deriveState(created), "pendingWitness");
    });
  });
});

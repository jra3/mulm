import { describe, test } from "node:test";
import assert from "node:assert";
import {
  deriveState,
  hasChangesRequested,
  requiredWaitingDays,
  waitingPeriod,
  type StateRow,
  hasConfirmedWitness,
} from "@/lifecycle";

/**
 * Where a Submission is, derived in one place.
 *
 * A badge, a queue and a guard all read this function, so these are the cases
 * that used to be re-derived from raw columns in six different predicates.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function row(overrides: Partial<StateRow> = {}): StateRow {
  return {
    submitted_on: null,
    approved_on: null,
    witness_verification_status: "pending",
    final_submission_on: null,
    reproduction_date: daysAgo(100),
    species_type: "Fish",
    species_class: "Livebearers",
    changes_requested_on: null,
    ...overrides,
  };
}

void describe("Derived state", () => {
  void test("a Submission with no submission date is a Draft", () => {
    assert.strictEqual(deriveState(row()), "draft");
  });

  void test("a submitted Submission awaits its Witness", () => {
    assert.strictEqual(deriveState(row({ submitted_on: daysAgo(1) })), "pendingWitness");
  });

  void test("a confirmed Witness inside the waiting period is in the waiting period", () => {
    const state = deriveState(
      row({
        submitted_on: daysAgo(1),
        witness_verification_status: "confirmed",
        reproduction_date: daysAgo(10),
      })
    );
    assert.strictEqual(state, "waitingPeriod");
  });

  void test("past the waiting period it waits on the member to bring it to a meeting", () => {
    const state = deriveState(
      row({ submitted_on: daysAgo(70), witness_verification_status: "confirmed" })
    );
    assert.strictEqual(state, "awaitingFinalSubmission");
  });

  void test("confirming it was brought to a meeting puts it in the approval queue", () => {
    const state = deriveState(
      row({
        submitted_on: daysAgo(70),
        witness_verification_status: "confirmed",
        final_submission_on: daysAgo(1),
      })
    );
    assert.strictEqual(state, "inApprovalQueue");
  });

  void test("Approved wins over everything, because it is terminal", () => {
    const state = deriveState(
      row({ submitted_on: daysAgo(70), approved_on: daysAgo(1), final_submission_on: daysAgo(2) })
    );
    assert.strictEqual(state, "approved");
  });

  void test("Changes requested is an overlay, so the Submission keeps its place", () => {
    const flagged = row({
      submitted_on: daysAgo(70),
      witness_verification_status: "confirmed",
      final_submission_on: daysAgo(1),
      changes_requested_on: daysAgo(1),
    });
    assert.strictEqual(deriveState(flagged), "inApprovalQueue");
    assert.strictEqual(hasChangesRequested(flagged), true);
  });

  void test("a Submission left 'declined' by the deleted decline path is screenable again", () => {
    const stranded = row({
      submitted_on: daysAgo(10),
      witness_verification_status: "declined",
    });
    assert.strictEqual(deriveState(stranded), "pendingWitness");
  });
});

void describe("The waiting-period clock", () => {
  void test("marine fish wait 30 days", () => {
    assert.strictEqual(
      requiredWaitingDays({ species_type: "Fish", species_class: "Marine" }),
      30
    );
  });

  void test("freshwater fish wait 60 days", () => {
    assert.strictEqual(
      requiredWaitingDays({ species_type: "Fish", species_class: "Livebearers" }),
      60
    );
  });

  void test("plants, corals and inverts wait 60 days", () => {
    for (const species_type of ["Plant", "Coral", "Invert"]) {
      assert.strictEqual(requiredWaitingDays({ species_type, species_class: "Marine" }), 60);
    }
  });

  void test("the clock reports what remains, and never goes negative", () => {
    const fresh = waitingPeriod({
      species_type: "Fish",
      species_class: "Livebearers",
      reproduction_date: daysAgo(10),
    });
    assert.strictEqual(fresh.daysRemaining, 50);
    assert.strictEqual(fresh.elapsed, false);

    const served = waitingPeriod({
      species_type: "Fish",
      species_class: "Livebearers",
      reproduction_date: daysAgo(400),
    });
    assert.strictEqual(served.daysRemaining, 0);
    assert.strictEqual(served.elapsed, true);
  });

  void test("a marine fish crosses the edge at 30 days, where a freshwater one does not", () => {
    const reproduction_date = daysAgo(31);
    assert.strictEqual(
      waitingPeriod({ species_type: "Fish", species_class: "Marine", reproduction_date }).elapsed,
      true
    );
    assert.strictEqual(
      waitingPeriod({ species_type: "Fish", species_class: "Livebearers", reproduction_date })
        .elapsed,
      false
    );
  });
});

void describe("A Witness a member's save would void", () => {
  void test("only a confirmed, unapproved Submission carries one", () => {
    assert.strictEqual(
      hasConfirmedWitness({ witness_verification_status: "confirmed", approved_on: undefined }),
      true
    );
    assert.strictEqual(
      hasConfirmedWitness({ witness_verification_status: "pending", approved_on: undefined }),
      false
    );
    assert.strictEqual(
      hasConfirmedWitness({
        witness_verification_status: "confirmed",
        approved_on: new Date().toISOString(),
      }),
      false,
      "Approved is terminal; nothing the member does can void it"
    );
  });
});

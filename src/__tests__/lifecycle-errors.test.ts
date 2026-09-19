import { describe, test } from "node:test";
import assert from "node:assert";
import {
  AuthorizationError,
  LifecycleError,
  StateError,
  ValidationError,
  isLifecycleError,
} from "@/lifecycle";

/**
 * The refusal taxonomy. A refused action must say whether the caller was the
 * wrong person or it was the wrong moment, so the Portal's refusals are
 * intelligible - and so a route can match on the class instead of on a message
 * string.
 */

void describe("Lifecycle errors", () => {
  void test("the base class carries a code and structured context", () => {
    const err = new LifecycleError("something", "SOMETHING", { submissionId: 7 });
    assert.ok(err instanceof Error);
    assert.strictEqual(err.name, "LifecycleError");
    assert.strictEqual(err.code, "SOMETHING");
    assert.deepStrictEqual(err.context, { submissionId: 7 });
  });

  void test("a validation refusal names the field and the value", () => {
    const err = new ValidationError("Submission not found", "submissionId", 42);
    assert.ok(err instanceof LifecycleError);
    assert.strictEqual(err.name, "ValidationError");
    assert.strictEqual(err.code, "VALIDATION_ERROR");
    assert.deepStrictEqual(err.context, { field: "submissionId", value: 42 });
  });

  void test("an authorization refusal names who was refused and what they tried", () => {
    const err = new AuthorizationError("Cannot witness your own submission", 3, "confirmWitness");
    assert.ok(err instanceof LifecycleError);
    assert.strictEqual(err.code, "AUTHORIZATION_ERROR");
    assert.deepStrictEqual(err.context, { userId: 3, action: "confirmWitness" });
  });

  void test("a state refusal names the moment it wanted and the one it found", () => {
    const err = new StateError("Cannot approve a draft", "inApprovalQueue", "draft");
    assert.ok(err instanceof LifecycleError);
    assert.strictEqual(err.code, "STATE_ERROR");
    assert.deepStrictEqual(err.context, {
      expectedState: "inApprovalQueue",
      actualState: "draft",
    });
  });

  void test("a deliberate refusal is told apart from a bug", () => {
    assert.strictEqual(isLifecycleError(new StateError("no", "a", "b")), true);
    assert.strictEqual(isLifecycleError(new Error("kaboom")), false);
    assert.strictEqual(isLifecycleError("not even an error"), false);
  });

  void test("each kind keeps its stack", () => {
    for (const err of [
      new ValidationError("x", "f", 1),
      new AuthorizationError("x", 1, "a"),
      new StateError("x", "a", "b"),
    ]) {
      assert.ok(err.stack, `${err.name} should carry a stack`);
    }
  });
});

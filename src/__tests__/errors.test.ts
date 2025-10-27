import { describe, test } from "node:test";
import assert from "node:assert";
import { WitnessError, ValidationError, AuthorizationError, StateError } from "../utils/errors";

void describe("Custom Error Classes", () => {
  void describe("WitnessError", () => {
    void test("should create error with message, code, and context", () => {
      const error = new WitnessError("Test error", "TEST_CODE", { foo: "bar" });

      assert.strictEqual(error.message, "Test error");
      assert.strictEqual(error.code, "TEST_CODE");
      assert.deepStrictEqual(error.context, { foo: "bar" });
      assert.strictEqual(error.name, "WitnessError");
    });

    void test("should work with default empty context", () => {
      const error = new WitnessError("Test error", "TEST_CODE");

      assert.deepStrictEqual(error.context, {});
    });

    void test("should be instance of Error", () => {
      const error = new WitnessError("Test", "CODE");

      assert.ok(error instanceof Error);
      assert.ok(error instanceof WitnessError);
    });

    void test("should have proper stack trace", () => {
      const error = new WitnessError("Test", "CODE");

      assert.ok(error.stack);
      assert.ok(error.stack?.includes("WitnessError"));
    });
  });

  void describe("ValidationError", () => {
    void test("should create validation error with field and value", () => {
      const error = new ValidationError("Invalid submission ID", "submissionId", 999);

      assert.strictEqual(error.message, "Invalid submission ID");
      assert.strictEqual(error.code, "VALIDATION_ERROR");
      assert.strictEqual(error.name, "ValidationError");
      assert.deepStrictEqual(error.context, { field: "submissionId", value: 999 });
    });

    void test("should handle null values in context", () => {
      const error = new ValidationError("Submission not found", "submissionId", null);

      assert.deepStrictEqual(error.context, { field: "submissionId", value: null });
    });

    void test("should handle undefined values in context", () => {
      const error = new ValidationError("Missing field", "requiredField", undefined);

      assert.deepStrictEqual(error.context, { field: "requiredField", value: undefined });
    });

    void test("should be instance of WitnessError and Error", () => {
      const error = new ValidationError("Test", "field", "value");

      assert.ok(error instanceof Error);
      assert.ok(error instanceof WitnessError);
      assert.ok(error instanceof ValidationError);
    });
  });

  void describe("AuthorizationError", () => {
    void test("should create authorization error with userId and action", () => {
      const error = new AuthorizationError("Cannot witness own submission", 123, "confirm_witness");

      assert.strictEqual(error.message, "Cannot witness own submission");
      assert.strictEqual(error.code, "AUTHORIZATION_ERROR");
      assert.strictEqual(error.name, "AuthorizationError");
      assert.deepStrictEqual(error.context, { userId: 123, action: "confirm_witness" });
    });

    void test("should be instance of WitnessError and Error", () => {
      const error = new AuthorizationError("Test", 1, "action");

      assert.ok(error instanceof Error);
      assert.ok(error instanceof WitnessError);
      assert.ok(error instanceof AuthorizationError);
    });
  });

  void describe("StateError", () => {
    void test("should create state error with expected and actual states", () => {
      const error = new StateError(
        "Submission not eligible for witnessing",
        "pending",
        "confirmed"
      );

      assert.strictEqual(error.message, "Submission not eligible for witnessing");
      assert.strictEqual(error.code, "STATE_ERROR");
      assert.strictEqual(error.name, "StateError");
      assert.deepStrictEqual(error.context, {
        expectedState: "pending",
        actualState: "confirmed",
      });
    });

    void test("should be instance of WitnessError and Error", () => {
      const error = new StateError("Test", "expected", "actual");

      assert.ok(error instanceof Error);
      assert.ok(error instanceof WitnessError);
      assert.ok(error instanceof StateError);
    });
  });

  void describe("Error catching and type checking", () => {
    void test("should catch WitnessError with instanceof", () => {
      try {
        throw new WitnessError("Test", "CODE");
      } catch (err) {
        assert.ok(err instanceof WitnessError);
        if (err instanceof WitnessError) {
          assert.strictEqual(err.code, "CODE");
        }
      }
    });

    void test("should distinguish between error types", () => {
      const validation = new ValidationError("Test", "field", "value");
      const authorization = new AuthorizationError("Test", 1, "action");
      const state = new StateError("Test", "exp", "act");

      assert.ok(validation instanceof ValidationError);
      assert.ok(!(validation instanceof AuthorizationError));
      assert.ok(!(validation instanceof StateError));

      assert.ok(authorization instanceof AuthorizationError);
      assert.ok(!(authorization instanceof ValidationError));

      assert.ok(state instanceof StateError);
      assert.ok(!(state instanceof ValidationError));

      // All are WitnessErrors
      assert.ok(validation instanceof WitnessError);
      assert.ok(authorization instanceof WitnessError);
      assert.ok(state instanceof WitnessError);
    });

    void test("should preserve error context through catch", () => {
      try {
        throw new ValidationError("Invalid ID", "submissionId", 999);
      } catch (err) {
        if (err instanceof ValidationError) {
          assert.strictEqual(err.code, "VALIDATION_ERROR");
          assert.deepStrictEqual(err.context, { field: "submissionId", value: 999 });
        } else {
          assert.fail("Expected ValidationError");
        }
      }
    });

    void test("should preserve stack trace through catch", () => {
      try {
        throw new StateError("Wrong state", "pending", "confirmed");
      } catch (err) {
        if (err instanceof StateError) {
          assert.ok(err.stack);
          assert.ok(err.stack?.includes("StateError"));
        } else {
          assert.fail("Expected StateError");
        }
      }
    });
  });

  void describe("Real-world usage patterns", () => {
    void test("should work with async error handling", async () => {
      const asyncFunction = async () => {
        throw new AuthorizationError("No permission", 42, "witness_submission");
      };

      await assert.rejects(
        async () => await asyncFunction(),
        (err: unknown) => {
          assert.ok(err instanceof AuthorizationError);
          if (err instanceof AuthorizationError) {
            assert.strictEqual(err.message, "No permission");
            assert.strictEqual(err.code, "AUTHORIZATION_ERROR");
            assert.deepStrictEqual(err.context, { userId: 42, action: "witness_submission" });
          }
          return true;
        }
      );
    });

    void test("should work in Promise.reject", async () => {
      const promise = Promise.reject(new ValidationError("Bad input", "field", "invalid"));

      await assert.rejects(
        async () => await promise,
        (err: unknown) => {
          assert.ok(err instanceof ValidationError);
          return true;
        }
      );
    });
  });
});

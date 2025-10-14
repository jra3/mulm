import { describe, test } from "node:test";
import assert from "node:assert";
import {
  validatePasswordComplexity,
  getPasswordRequirementsMessage,
} from "../auth/passwordComplexity";

describe("Password Complexity Validation", () => {
  describe("Level 1 - Length Only (Default)", () => {
    test("should reject passwords shorter than 12 characters", () => {
      const result = validatePasswordComplexity("short");
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes("12 characters"));
    });

    test("should accept passwords with 12+ characters", () => {
      const result = validatePasswordComplexity("thisislongenough");
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    test("should accept simple long passwords at level 1", () => {
      // Level 1 doesn't require complexity, just length
      const passwords = [
        "aaaaaaaaaaaa", // 12 a's
        "111111111111", // 12 1's
        "password1234", // Common but long
      ];

      passwords.forEach((password) => {
        const result = validatePasswordComplexity(password);
        assert.strictEqual(result.valid, true, `"${password}" should be valid at level 1`);
      });
    });

    test("should accept passphrases", () => {
      const result = validatePasswordComplexity("correct horse battery staple");
      assert.strictEqual(result.valid, true);
    });
  });

  describe("Password Requirements Message", () => {
    test("should return appropriate message for current level", () => {
      const message = getPasswordRequirementsMessage();
      assert.ok(message.includes("12 characters"));
    });
  });

  describe("Edge Cases", () => {
    test("should handle exactly 12 characters", () => {
      const result = validatePasswordComplexity("exactlytwelv");
      assert.strictEqual(result.valid, true);
    });

    test("should handle very long passwords", () => {
      const longPassword = "a".repeat(100);
      const result = validatePasswordComplexity(longPassword);
      assert.strictEqual(result.valid, true);
    });

    test("should handle empty string", () => {
      const result = validatePasswordComplexity("");
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes("12 characters"));
    });

    test("should handle special characters at level 1", () => {
      const result = validatePasswordComplexity("!@#$%^&*()_+");
      assert.strictEqual(result.valid, true);
    });

    test("should handle unicode characters", () => {
      // 12 unicode characters
      const result = validatePasswordComplexity("密码很强大的密码密码强大");
      assert.strictEqual(result.valid, true);
    });

    test("should handle spaces", () => {
      const result = validatePasswordComplexity("my secure password");
      assert.strictEqual(result.valid, true);
    });
  });

  describe("Multiple Error Reporting", () => {
    test("should report all errors for invalid password", () => {
      const result = validatePasswordComplexity("ab");
      assert.strictEqual(result.valid, false);
      // At level 1, should only have length error
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes("12 characters"));
    });
  });
});

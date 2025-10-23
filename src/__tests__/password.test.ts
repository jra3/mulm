import { describe, test } from "node:test";
import assert from "node:assert";
import { checkPassword, makePasswordEntry } from "../auth";

void describe("Password Hashing", () => {
  void test("should hash and verify passwords correctly", async () => {
    const salty = await makePasswordEntry("hashy");
    assert.strictEqual(await checkPassword(salty, "hashy"), true);
    assert.strictEqual(await checkPassword(salty, "not hashy"), false);
  });
});

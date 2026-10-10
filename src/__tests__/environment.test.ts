import { describe, test } from "node:test";
import assert from "node:assert";
import { isLiveProduction, isStaging } from "../utils/environment";

void describe("isStaging", () => {
  void test("only the exact value 1 marks staging", () => {
    assert.strictEqual(isStaging({ STAGING: "1" }), true);
    for (const env of [{}, { STAGING: "0" }, { STAGING: "true" }, { STAGING: "" }]) {
      assert.strictEqual(isStaging(env), false);
    }
  });
});

void describe("isLiveProduction", () => {
  void test("production without STAGING is the live site", () => {
    assert.strictEqual(isLiveProduction({ NODE_ENV: "production" }), true);
  });

  void test("staging runs NODE_ENV=production but is not the live site", () => {
    assert.strictEqual(isLiveProduction({ NODE_ENV: "production", STAGING: "1" }), false);
  });

  void test("development and test are not the live site", () => {
    assert.strictEqual(isLiveProduction({ NODE_ENV: "development" }), false);
    assert.strictEqual(isLiveProduction({ NODE_ENV: "test" }), false);
  });
});

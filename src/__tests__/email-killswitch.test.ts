import { describe, test } from "node:test";
import assert from "node:assert";
import { emailsDisabled } from "../notifications";

void describe("emailsDisabled", () => {
  void test("STAGING=1 disables email even when the config enables it", () => {
    assert.strictEqual(
      emailsDisabled({ NODE_ENV: "production", STAGING: "1" }, { disableEmails: false }),
      true
    );
  });

  void test("production with email enabled in config sends", () => {
    assert.strictEqual(emailsDisabled({ NODE_ENV: "production" }, { disableEmails: false }), false);
  });

  void test("the config killswitch disables email", () => {
    assert.strictEqual(emailsDisabled({ NODE_ENV: "production" }, { disableEmails: true }), true);
  });

  void test("test mode disables email", () => {
    assert.strictEqual(emailsDisabled({ NODE_ENV: "test" }, {}), true);
  });
});

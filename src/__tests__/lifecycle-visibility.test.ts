import { describe, test } from "node:test";
import assert from "node:assert";
import { isVisibleTo } from "@/lifecycle";

/**
 * Who may see a Submission's page. Approved work is public; anything short of
 * approval belongs to its member and the committee, matching the profile page.
 */

const OWNER = { id: 7, is_admin: false };
const STRANGER = { id: 8, is_admin: false };
const COMMITTEE = { id: 9, is_admin: true };

// Draft or anywhere in the pipeline: only approved_on matters.
const unapproved = { member_id: 7, approved_on: null };
const approved = { member_id: 7, approved_on: "2026-09-01T00:00:00Z" };

void describe("isVisibleTo", () => {
  void test("approved is visible to everyone, logged in or not", () => {
    for (const viewer of [undefined, STRANGER, OWNER, COMMITTEE]) {
      assert.strictEqual(isVisibleTo(approved, viewer), true);
    }
  });

  void test("unapproved is hidden from anonymous visitors and other members", () => {
    assert.strictEqual(isVisibleTo(unapproved, undefined), false);
    assert.strictEqual(isVisibleTo(unapproved, STRANGER), false);
  });

  void test("unapproved is visible to its member and the committee", () => {
    assert.strictEqual(isVisibleTo(unapproved, OWNER), true);
    assert.strictEqual(isVisibleTo(unapproved, COMMITTEE), true);
  });
});

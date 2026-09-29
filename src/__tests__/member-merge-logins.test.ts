/**
 * Merging two members keeps the source's ways of logging in wherever the
 * destination has none (#442 review). Otherwise a duplicate made by a Google
 * or Apple sign-in loses its link on merge and the next sign-in makes a
 * fresh duplicate.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";
import {
  createAppleAccount,
  createGoogleAccount,
  createMember,
  getAppleAccount,
  getAppleAccountByMemberId,
  getGoogleAccountByMemberId,
  getMember,
} from "@/db/members";
import { handleMergeMembers } from "@/mcp/member-server-core";
import { resolveAppleMember } from "@/auth/apple";

void describe("merge_members and login methods", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  void test("a relay-address duplicate's Apple identity moves to the survivor", async () => {
    const keeper = await createMember("real@example.com", "Real", { password: "Str0ng!Passw0rd" });
    const dupe = await createMember("k3j2h@privaterelay.appleid.com", "k3j2h", {
      apple_sub: "001.relay",
    });

    await handleMergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual(await getMember(dupe), undefined);
    assert.strictEqual((await getAppleAccount("001.relay"))?.member_id, keeper);
    // The next Apple sign-in lands on the survivor.
    const next = await resolveAppleMember(
      { sub: "001.relay", email: "k3j2h@privaterelay.appleid.com", emailVerified: true, isPrivateEmail: true },
      "x"
    );
    assert.strictEqual(next, keeper);
  });

  void test("the destination keeps its own login of a kind it already has", async () => {
    const keeper = await createMember("keep@example.com", "Keep");
    await createAppleAccount(keeper, "001.keep", "keep@example.com");
    await createGoogleAccount(keeper, "g-keep", "keep@example.com");
    const dupe = await createMember("dupe@example.com", "Dupe");
    await createAppleAccount(dupe, "001.dupe", "dupe@example.com");

    await handleMergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual((await getAppleAccountByMemberId(keeper))?.apple_sub, "001.keep");
    assert.strictEqual(await getAppleAccount("001.dupe"), undefined);
    assert.strictEqual((await getGoogleAccountByMemberId(keeper))?.google_sub, "g-keep");
  });

  void test("a Google-only duplicate's link moves too", async () => {
    const keeper = await createMember("keep@example.com", "Keep");
    const dupe = await createMember("dupe@example.com", "Dupe", { google_sub: "g-dupe" });

    await handleMergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual((await getGoogleAccountByMemberId(keeper))?.google_sub, "g-dupe");
  });
});

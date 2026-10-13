/**
 * Merging two members keeps the source's ways of logging in wherever the
 * destination has none (#442 review). Otherwise a duplicate made by a Google
 * or Apple sign-in loses its link on merge and the next sign-in makes a
 * fresh duplicate.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import {
  createAppleAccount,
  createGoogleAccount,
  createMember,
  getAppleAccount,
  getAppleAccountByMemberId,
  getGoogleAccountByMemberId,
  getMember,
} from "@/db/members";
import { mergeMembers } from "@/members/merge";
import { resolveAppleMember } from "@/auth/apple";

void describe("merge_members and login methods", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  void test("a relay-address duplicate's Apple identity moves to the survivor", async () => {
    const keeper = await createMember("real@example.com", "Real", { password: "Str0ng!Passw0rd" });
    const dupe = await createMember("k3j2h@privaterelay.appleid.com", "k3j2h", {
      apple_sub: "001.relay",
    });

    await mergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual(await getMember(dupe), undefined);
    assert.strictEqual((await getAppleAccount("001.relay"))?.member_id, keeper);
    // The next Apple sign-in lands on the survivor.
    const next = await resolveAppleMember(
      {
        sub: "001.relay",
        email: "k3j2h@privaterelay.appleid.com",
        emailVerified: true,
        isPrivateEmail: true,
      },
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

    await mergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual((await getAppleAccountByMemberId(keeper))?.apple_sub, "001.keep");
    assert.strictEqual(await getAppleAccount("001.dupe"), undefined);
    assert.strictEqual((await getGoogleAccountByMemberId(keeper))?.google_sub, "g-keep");
  });

  void test("a Google-only duplicate's link moves too", async () => {
    const keeper = await createMember("keep@example.com", "Keep");
    const dupe = await createMember("dupe@example.com", "Dupe", { google_sub: "g-dupe" });

    await mergeMembers({ from_member_id: dupe, to_member_id: keeper });

    assert.strictEqual((await getGoogleAccountByMemberId(keeper))?.google_sub, "g-dupe");
  });

  void test("preview leaves data intact, execution moves data and a password login", async () => {
    const keeper = await createMember("keep@example.com", "Keep");
    const dupe = await createMember("dupe@example.com", "Dupe", { password: "Str0ng!Passw0rd" });
    await testDb.db.run(
      `INSERT INTO submissions (member_id, program, species_type, species_class, species_common_name, species_latin_name) VALUES (?, 'fish', 'Fish', 'Livebearers', 'Guppy', 'Poecilia reticulata')`,
      dupe
    );
    await testDb.db.run(
      "INSERT INTO awards (member_id, award_name) VALUES (?, 'Test award')",
      dupe
    );
    await testDb.db.run(
      "INSERT INTO tank_presets (member_id, preset_name) VALUES (?, 'Test tank')",
      dupe
    );
    const preview = await mergeMembers({
      from_member_id: dupe,
      to_member_id: keeper,
      preview: true,
    });
    assert.strictEqual(preview.preview, true);
    assert.strictEqual(preview.preview_data.from_member.submission_count, 1);
    assert.ok(await getMember(dupe));
    assert.strictEqual(
      (await testDb.db.get<{ member_id: number }>("SELECT member_id FROM password_account"))
        ?.member_id,
      dupe
    );
    const result = await mergeMembers({ from_member_id: dupe, to_member_id: keeper });
    assert.ok("submissions_moved" in result);
    assert.strictEqual(result.submissions_moved, 1);
    assert.strictEqual(result.awards_moved, 1);
    assert.strictEqual(result.tank_presets_moved, 1);
    for (const table of ["submissions", "awards", "tank_presets", "password_account"]) {
      assert.strictEqual(
        (await testDb.db.get<{ member_id: number }>(`SELECT member_id FROM ${table}`))?.member_id,
        keeper
      );
    }
  });

  void test("refuses self-merges and missing members without changing the survivor", async () => {
    const keeper = await createMember("keep@example.com", "Keep");
    await assert.rejects(mergeMembers({ from_member_id: keeper, to_member_id: keeper }), /itself/);
    await assert.rejects(
      mergeMembers({ from_member_id: 999999, to_member_id: keeper }),
      /Source member/
    );
    await assert.rejects(
      mergeMembers({ from_member_id: keeper, to_member_id: 999999 }),
      /Destination member/
    );
    assert.ok(await getMember(keeper));
  });
});

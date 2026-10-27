import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import path from "path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import caresRouter from "@/routes/cares";
import * as submission from "@/routes/submission";
import { createMember } from "@/db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { submissionInState } from "./helpers/lifecycleFixtures";

/**
 * The CARES registration prompt (#282): the owner of an Approved Submission
 * of a CARES-listed Species is offered the registration, unless they already
 * have one, and only while the registry's gate lets them see it.
 */
function appAs(viewer: MulmRequest["viewer"]) {
  const app = express();
  app.set("views", path.join(__dirname, "../views"));
  app.set("view engine", "pug");
  app.use((req: MulmRequest, _res, next) => {
    req.viewer = viewer;
    next();
  });
  app.get("/submissions/:id", submission.view);
  app.use("/", caresRouter);
  return app;
}

type Viewer = NonNullable<MulmRequest["viewer"]>;

void describe("CARES registration prompt", () => {
  let testDb: TestDatabase;
  let caresGroupId: number;
  let plainGroupId: number;
  let committeeId: number;
  // An admin is the only Member the registry's gate lets in today
  let ownerAdmin: Viewer;
  let ownerMember: Viewer;
  let otherAdmin: Viewer;

  async function species(genus: string, isCares: boolean): Promise<number> {
    const result = await testDb.db.run(
      `INSERT INTO species_name_group (
         program_class, species_type, canonical_genus, canonical_species_name,
         base_points, is_cares_species
       ) VALUES ('Livebearers', 'Fish', ?, 'testprompt', 10, ?)`,
      [genus, isCares ? 1 : 0]
    );
    return result.lastID as number;
  }

  const approvedOf = (memberId: number, speciesId: number) =>
    submissionInState(testDb.db, "approved", {
      memberId,
      witnessedBy: committeeId,
      points: 10,
      speciesId,
    });

  const promptOn = async (viewer: Viewer, submissionId: number) => {
    const res = await request(appAs(viewer)).get(`/submissions/${submissionId}`);
    assert.strictEqual(res.status, 200);
    return /id="cares-prompt"/.test(res.text) ? res.text : null;
  };

  beforeEach(async () => {
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    committeeId = await createMember("witness@example.com", "Jane Ortiz", {}, true);
    const adminOwnerId = await createMember("keeper@example.com", "Kim Admin", {}, true);
    const memberOwnerId = await createMember("member@example.com", "Mo Member");
    const otherAdminId = await createMember("other@example.com", "Oz Admin", {}, true);
    ownerAdmin = { id: adminOwnerId, display_name: "Kim Admin", contact_email: "keeper@example.com", is_admin: true };
    ownerMember = { id: memberOwnerId, display_name: "Mo Member", contact_email: "member@example.com", is_admin: false };
    otherAdmin = { id: otherAdminId, display_name: "Oz Admin", contact_email: "other@example.com", is_admin: true };
    caresGroupId = await species("Xenotoca", true);
    plainGroupId = await species("Poecilia", false);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  void describe("on the Submission page", () => {
    void test("is offered to the owner of an Approved CARES Submission, linked to that Species", async () => {
      const id = await approvedOf(ownerAdmin.id, caresGroupId);
      const page = await promptOn(ownerAdmin, id);
      assert.ok(page, "prompt shown");
      assert.match(page, new RegExp(`hx-get="/dialog/cares/register\\?species=${caresGroupId}"`));
      assert.match(page, /Maybe Later/);
    });

    void test("is hidden from a non-admin Member while the registry is admin-only", async () => {
      const id = await approvedOf(ownerMember.id, caresGroupId);
      const res = await request(appAs(ownerMember)).get(`/submissions/${id}`);
      assert.strictEqual(res.status, 200);
      assert.doesNotMatch(res.text, /id="cares-prompt"/);
      assert.doesNotMatch(res.text, /\/dialog\/cares\//);
    });

    void test("is not offered to someone else viewing the Submission", async () => {
      const id = await approvedOf(ownerAdmin.id, caresGroupId);
      assert.strictEqual(await promptOn(otherAdmin, id), null);
    });

    void test("is not offered once the owner has registered the Species", async () => {
      const id = await approvedOf(ownerAdmin.id, caresGroupId);
      await testDb.db.run(
        `INSERT INTO cares_registration (member_id, species_group_id) VALUES (?, ?)`,
        [ownerAdmin.id, caresGroupId]
      );
      assert.strictEqual(await promptOn(ownerAdmin, id), null);
    });

    void test("is not offered for a Species off the CARES list", async () => {
      const id = await approvedOf(ownerAdmin.id, plainGroupId);
      assert.strictEqual(await promptOn(ownerAdmin, id), null);
    });

    void test("is not offered before the Submission is approved", async () => {
      const id = await submissionInState(testDb.db, "inApprovalQueue", {
        memberId: ownerAdmin.id,
        witnessedBy: committeeId,
        points: 10,
        speciesId: caresGroupId,
      });
      assert.strictEqual(await promptOn(ownerAdmin, id), null);
    });
  });

  void describe("the registration dialog for a Species", () => {
    const dialog = (viewer: Viewer, query: string) =>
      request(appAs(viewer)).get(`/dialog/cares/register${query}`);

    void test("opens the collection entry's registration with the Species chosen", async () => {
      const entry = await testDb.db.run(
        `INSERT INTO species_collection (member_id, group_id, common_name, visibility)
         VALUES (?, ?, 'Test Splitfin', 'public')`,
        [ownerAdmin.id, caresGroupId]
      );
      const res = await dialog(ownerAdmin, `?species=${caresGroupId}`);
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /hx-post="\/api\/cares\/register"/);
      assert.match(res.text, new RegExp(`name="collection_entry_id" value="${entry.lastID}"`));
    });

    void test("without a collection entry, adds the Species to the collection first", async () => {
      const res = await dialog(ownerAdmin, `?species=${caresGroupId}`);
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /hx-post="\/api\/collection"/);
      assert.match(res.text, new RegExp(`name="group_id" value="${caresGroupId}"`));
      assert.match(res.text, /Xenotoca testprompt/);
    });

    void test("refuses a Species already registered, off the list, unknown or missing", async () => {
      await testDb.db.run(
        `INSERT INTO cares_registration (member_id, species_group_id) VALUES (?, ?)`,
        [ownerAdmin.id, caresGroupId]
      );
      const cases: Array<[string, number, RegExp]> = [
        [`?species=${caresGroupId}`, 400, /already registered/],
        [`?species=${plainGroupId}`, 400, /not part of the CARES priority list/],
        ["?species=999999", 404, /not in the database/],
        ["?species=abc", 400, /Choose a species/],
        ["", 400, /Choose a species/],
      ];
      for (const [query, status, message] of cases) {
        const res = await dialog(ownerAdmin, query);
        assert.strictEqual(res.status, status, query);
        assert.match(res.text, message, query);
        assert.doesNotMatch(res.text, /hx-post=/, query);
      }
    });

    void test("is not found for a non-admin Member while the registry is admin-only", async () => {
      const res = await dialog(ownerMember, `?species=${caresGroupId}`);
      assert.strictEqual(res.status, 404);
    });
  });
});

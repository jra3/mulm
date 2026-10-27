import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import * as member from "@/routes/member";
import { addToCollection, removeFromCollection } from "@/db/collection";
import { createMember } from "@/db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

/** The owner's Current / History views of their collection page (#562). */
void describe("collection history view", () => {
  let fixture: TestDatabase;
  let ownerId: number;
  let otherId: number;
  let adminId: number;

  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    ownerId = await createMember("owner@example.test", "Owner");
    otherId = await createMember("other@example.test", "Other");
    adminId = await createMember("admin@example.test", "Admin", {}, true);

    await addToCollection(ownerId, { common_name: "Kept Guppy" });
    await addToCollection(ownerId, { common_name: "Kept Private Molly", visibility: "private" });
    const gone = await addToCollection(ownerId, {
      common_name: "Gone Tetra",
      acquired_date: "2024-03-01",
    });
    await removeFromCollection(gone, ownerId);
    const goneSecret = await addToCollection(ownerId, {
      common_name: "Gone Secret Pleco",
      visibility: "private",
    });
    await removeFromCollection(goneSecret, ownerId);
    // A legacy row: removed long ago, no acquisition date recorded.
    await fixture.db.run(
      "UPDATE species_collection SET removed_date = '2019-06-15' WHERE id = ?",
      goneSecret
    );
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function appAs(id?: number) {
    const app = express();
    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");
    app.use((req: MulmRequest, res, next) => {
      req.viewer = id
        ? { id, display_name: "Viewer", contact_email: "viewer@example.test", is_admin: id === adminId }
        : undefined;
      res.locals.showCaresRegistry = false;
      next();
    });
    app.get("/member/:memberId/collection", member.viewCollection);
    return app;
  }

  const page = (as: number | undefined, query = "") =>
    request(appAs(as)).get(`/member/${ownerId}/collection${query}`);

  void test("the owner defaults to Current, with current-only counts and a History tab", async () => {
    const res = await page(ownerId);
    assert.equal(res.status, 200);
    assert.match(res.text, /Kept Guppy/);
    assert.match(res.text, /Kept Private Molly/);
    assert.doesNotMatch(res.text, /Gone Tetra|Gone Secret Pleco/);
    assert.match(res.text, /aria-current="page"[^>]*>Current \(2\)/);
    assert.match(res.text, />History \(2\)</);
    assert.match(res.text, /Lifetime: 4 entries/);
  });

  void test("History lists removed entries, public and private, labelled and dated", async () => {
    const res = await page(ownerId, "?view=history");
    assert.equal(res.status, 200);
    assert.match(res.text, /aria-current="page"[^>]*>History \(2\)/);
    assert.match(res.text, /Gone Tetra/);
    assert.match(res.text, /Gone Secret Pleco/);
    assert.doesNotMatch(res.text, /Kept Guppy|Kept Private Molly/);
    assert.equal(res.text.match(/No longer kept/g)?.length, 2);
    assert.equal(res.text.match(/Removed:/g)?.length, 2);
    // Only the entry with a recorded acquisition date shows one.
    assert.equal(res.text.match(/Acquired:/g)?.length, 1);
    // History is read-only: no edit, restore or CARES controls.
    assert.doesNotMatch(res.text, /\/dialog\/collection\/edit\//);
    assert.doesNotMatch(res.text, /\/dialog\/cares\//);
  });

  void test("an empty history explains itself", async () => {
    const fresh = await createMember("fresh@example.test", "Fresh");
    await addToCollection(fresh, { common_name: "Only Fish" });
    const res = await request(appAs(fresh)).get(`/member/${fresh}/collection?view=history`);
    assert.match(res.text, /No Collection History Yet/);
    assert.match(res.text, />History \(0\)</);
  });

  for (const [who, id] of [
    ["another member", () => otherId],
    ["an admin", () => adminId],
    ["a signed-out visitor", () => undefined],
  ] as const) {
    void test(`${who} asking for ?view=history gets the current collection only`, async () => {
      const res = await page(id(), "?view=history");
      assert.equal(res.status, 200);
      assert.match(res.text, /Kept Guppy/);
      assert.doesNotMatch(res.text, /Gone Tetra|Gone Secret Pleco|No longer kept/);
      assert.doesNotMatch(res.text, /view=history/);
    });
  }

  void test("an unknown view falls back to Current", async () => {
    const res = await page(ownerId, "?view=everything");
    assert.equal(res.status, 200);
    assert.match(res.text, /Kept Guppy/);
    assert.doesNotMatch(res.text, /Gone Tetra/);
  });

  void test("viewing history restores nothing and creates no registrations", async () => {
    const before = await fixture.db.all("SELECT * FROM species_collection ORDER BY id");
    await page(ownerId, "?view=history");
    assert.deepEqual(await fixture.db.all("SELECT * FROM species_collection ORDER BY id"), before);
    const registrations = await fixture.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM cares_registration"
    );
    assert.equal(registrations?.n, 0);
  });
});

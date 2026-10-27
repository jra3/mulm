import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import * as species from "@/routes/species";
import collectionRouter from "@/routes/collection";
import { addToCollection, removeFromCollection } from "@/db/collection";
import { createMember } from "@/db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

/** Adding a Species from its detail page, with that Species preselected (#561). */
void describe("add to collection from a Species page", () => {
  let fixture: TestDatabase;
  let memberId: number;
  let keeperId: number;
  let speciesId: number;

  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("first@example.test", "First Keeper");
    keeperId = await createMember("keeper@example.test", "Other Keeper");
    const result = await fixture.db.run(`INSERT INTO species_name_group
      (program_class, species_type, canonical_genus, canonical_species_name, is_cares_species)
      VALUES ('Livebearers', 'Fish', 'Preselectus', 'firstus', 1)`);
    speciesId = result.lastID!;
    await fixture.db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      speciesId,
      "First Fish"
    );
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function appAs(id?: number) {
    const app = express();
    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");
    app.use(express.urlencoded({ extended: false }));
    app.use((req: MulmRequest, _res, next) => {
      req.viewer = id
        ? { id, display_name: "Viewer", contact_email: "viewer@example.test" }
        : undefined;
      next();
    });
    app.get("/species/:groupId", species.detail);
    app.use(collectionRouter);
    return app;
  }

  const addButtonFor = (id: number) => `hx-get="/dialog/collection/add?species=${id}"`;

  void test("the first keeper sees an Add action and an empty-keeper message", async () => {
    const res = await request(appAs(memberId)).get(`/species/${speciesId}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(addButtonFor(speciesId)), "Add to Collection carries the Species");
    assert.match(res.text, /No members publicly list this species yet. Be the first/);
  });

  void test("members see the Add action alongside one or many keepers", async () => {
    const third = await createMember("third@example.test", "Third Keeper");
    for (const [keepers, count] of [[[keeperId], "1 member currently keeps"], [[keeperId, third], "2 members currently keep"]] as const) {
      for (const id of keepers) {
        await fixture.db.run(
          "INSERT OR IGNORE INTO species_collection (member_id, group_id) VALUES (?, ?)",
          id,
          speciesId
        );
      }
      const res = await request(appAs(memberId)).get(`/species/${speciesId}`);
      assert.match(res.text, new RegExp(count));
      assert.ok(res.text.includes(addButtonFor(speciesId)));
    }
  });

  void test("signed-out visitors see no Add action and cannot open the dialog", async () => {
    const page = await request(appAs()).get(`/species/${speciesId}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes("/dialog/collection/add"));
    assert.match(page.text, /No members publicly list this species yet/);
    assert.doesNotMatch(page.text, /Be the first/);

    const dialog = await request(appAs()).get(`/dialog/collection/add?species=${speciesId}`);
    assert.equal(dialog.status, 401);
  });

  void test("a member who already keeps it sees In your collection, not Add", async () => {
    await addToCollection(memberId, { group_id: speciesId, visibility: "private" });
    const res = await request(appAs(memberId)).get(`/species/${speciesId}`);
    assert.ok(!res.text.includes(addButtonFor(speciesId)));
    assert.match(res.text, /In your collection/);
    assert.ok(res.text.includes(`href="/member/${memberId}/collection"`));
    // A private keeper is not a public keeper, and is not told to be the first.
    assert.match(res.text, /No members publicly list this species yet</);
    assert.doesNotMatch(res.text, /currently keep|Be the first/);
  });

  void test("a removed entry does not count as kept", async () => {
    const entry = await addToCollection(memberId, { group_id: speciesId });
    await removeFromCollection(entry, memberId);
    const res = await request(appAs(memberId)).get(`/species/${speciesId}`);
    assert.ok(res.text.includes(addButtonFor(speciesId)));
  });

  void test("the dialog preselects the canonical Species and fills its names", async () => {
    const res = await request(appAs(memberId)).get(`/dialog/collection/add?species=${speciesId}`);
    assert.equal(res.status, 200);
    assert.match(
      res.text,
      new RegExp(`<option value="${speciesId}" selected="selected">First Fish \\(Preselectus firstus\\)</option>`)
    );
    assert.match(res.text, /id="common_name"[^>]*value="First Fish"/);
    assert.match(res.text, /id="scientific_name"[^>]*value="Preselectus firstus"/);
    assert.doesNotMatch(res.text, /could not be found/);
    assert.doesNotMatch(res.text, /already in your collection/);
  });

  void test("the generic dialog still offers search with nothing selected", async () => {
    const res = await request(appAs(memberId)).get("/dialog/collection/add");
    assert.equal(res.status, 200);
    assert.match(res.text, /data-api-url="\/api\/species\/search"/);
    assert.match(res.text, /data-placeholder="Search species..." [^>]*><\/select>/);
    assert.doesNotMatch(res.text, /could not be found/);
  });

  for (const bad of ["abc", "-3", "0", "1.5", "999999"]) {
    void test(`species=${bad} opens the generic dialog with a notice`, async () => {
      const res = await request(appAs(memberId)).get(`/dialog/collection/add?species=${bad}`);
      assert.equal(res.status, 200);
      assert.match(res.text, /That species could not be found/);
      assert.match(res.text, /data-api-url="\/api\/species\/search"/);
      assert.match(res.text, /data-placeholder="Search species..." [^>]*><\/select>/);
    });
  }

  void test("the dialog warns when the Species is already in the collection", async () => {
    await addToCollection(memberId, { group_id: speciesId });
    const res = await request(appAs(memberId)).get(`/dialog/collection/add?species=${speciesId}`);
    assert.match(res.text, /already in your collection/);
  });

  void test("saving the preselected dialog adds the entry without a CARES registration", async () => {
    const res = await request(appAs(memberId)).post("/api/collection").type("form").send({
      group_id: String(speciesId),
      common_name: "First Fish",
      scientific_name: "Preselectus firstus",
      acquired_date: "",
      visibility: "public",
      notes: "",
    });
    assert.equal(res.status, 200);
    const rows = await fixture.db.all<{ group_id: number }[]>(
      "SELECT group_id FROM species_collection WHERE member_id = ? AND removed_date IS NULL",
      memberId
    );
    assert.deepEqual(rows.map((r) => r.group_id), [speciesId]);
    assert.equal(
      (await fixture.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM cares_registration"))?.n,
      0
    );

    const duplicate = await request(appAs(memberId)).post("/api/collection").type("form").send({
      group_id: String(speciesId),
    });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.text, /already in your collection/);
  });
});

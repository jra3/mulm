import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import request from "supertest";
import { addToCollection } from "@/db/collection";
import { createMember } from "@/db/members";
import collectionRouter from "@/routes/collection";
import type { MulmRequest } from "@/sessions";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

/** Removing a photo from a collection entry in the edit dialog (#560). */
void describe("POST /api/collection/:id/images/remove", () => {
  let fixture: TestDatabase;
  let memberId: number;
  let otherId: number;
  let entryId: number;
  let otherEntryId: number;

  const photo = (key: string) => ({
    key,
    url: `https://images.test/${key}`,
    size: 1,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    contentType: "image/jpeg",
  });
  const keys = ["submissions/1/1/a-original.jpg", "submissions/1/1/b-original.jpg"];

  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("owner@example.test", "Owner");
    otherId = await createMember("other@example.test", "Other");
    entryId = await addToCollection(memberId, { common_name: "Guppy", notes: "keep me" });
    otherEntryId = await addToCollection(otherId, { common_name: "Molly" });
    await fixture.db.run(
      "UPDATE species_collection SET images = ? WHERE id = ?",
      JSON.stringify(keys.map(photo)),
      entryId
    );
    await fixture.db.run(
      "UPDATE species_collection SET images = ? WHERE id = ?",
      JSON.stringify([photo("submissions/2/2/foreign-original.jpg")]),
      otherEntryId
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
    app.use(collectionRouter);
    return app;
  }

  const remove = (key: string, as = memberId, entry = entryId) =>
    request(appAs(as)).post(`/api/collection/${entry}/images/remove`).type("form").send({ key });

  const storedKeys = async (id = entryId) => {
    const row = await fixture.db.get<{ images: string | null; notes: string }>(
      "SELECT images, notes FROM species_collection WHERE id = ?",
      id
    );
    return row?.images ? (JSON.parse(row.images) as { key: string }[]).map((i) => i.key) : null;
  };

  void test("removes the selected photo, keeps the others, and re-renders the grid", async () => {
    const res = await remove(keys[0]);
    assert.equal(res.status, 200);
    assert.deepEqual(await storedKeys(), [keys[1]]);
    assert.match(res.text, /id="collection-photos"/);
    assert.match(res.text, /Photo removed/);
    assert.ok(!res.text.includes("a-thumb.jpg"));
    assert.ok(res.text.includes("b-thumb.jpg"));
    assert.ok(res.text.includes(`aria-label="Remove photo 1"`));
    const notes = await fixture.db.get<{ notes: string }>(
      "SELECT notes FROM species_collection WHERE id = ?",
      entryId
    );
    assert.equal(notes?.notes, "keep me");
  });

  void test("removing the last photo leaves no photos and the dialog shows none", async () => {
    await remove(keys[0]);
    const res = await remove(keys[1]);
    assert.equal(res.status, 200);
    assert.equal(await storedKeys(), null);
    assert.match(res.text, /No photos yet/);

    const dialog = await request(appAs(memberId)).get(`/dialog/collection/edit/${entryId}`);
    assert.equal(dialog.status, 200);
    assert.match(dialog.text, /No photos yet/);
    assert.ok(!dialog.text.includes("images/remove"));
  });

  void test("a repeated request removes nothing else and reports the current photos", async () => {
    await remove(keys[0]);
    const again = await remove(keys[0]);
    assert.equal(again.status, 409);
    assert.match(again.text, /already removed/);
    assert.ok(again.text.includes("b-thumb.jpg"));
    assert.deepEqual(await storedKeys(), [keys[1]]);
  });

  void test("a key from another member's entry is refused without changes", async () => {
    const res = await remove("submissions/2/2/foreign-original.jpg");
    assert.equal(res.status, 409);
    assert.deepEqual(await storedKeys(), keys);
    assert.deepEqual(await storedKeys(otherEntryId), ["submissions/2/2/foreign-original.jpg"]);
  });

  void test("anonymous, foreign and missing-entry requests are refused", async () => {
    assert.equal((await remove(keys[0], 0)).status, 401);
    const foreign = await remove("submissions/2/2/foreign-original.jpg", memberId, otherEntryId);
    assert.equal(foreign.status, 403);
    assert.equal((await remove(keys[0], otherId)).status, 403);
    assert.equal((await remove(keys[0], memberId, 999999)).status, 403);
    assert.equal((await remove("", memberId)).status, 400);
    assert.deepEqual(await storedKeys(), keys);
    assert.deepEqual(await storedKeys(otherEntryId), ["submissions/2/2/foreign-original.jpg"]);
  });

  void test("a persistence failure keeps every photo and offers a retry", async () => {
    await fixture.db.exec(`CREATE TRIGGER fail_photo AFTER UPDATE OF images ON species_collection
      BEGIN SELECT RAISE(ABORT, 'write failed'); END`);
    const res = await remove(keys[0]);
    assert.equal(res.status, 500);
    assert.match(res.text, /Could not remove the photo. Please try again/);
    assert.ok(res.text.includes("a-thumb.jpg"), "the photo is still shown with its remove control");
    assert.ok(res.text.includes(`hx-post="/api/collection/${entryId}/images/remove"`));
    assert.deepEqual(await storedKeys(), keys);
  });

  void test("the edit dialog's remove control posts the stored key, not a position", async () => {
    const dialog = await request(appAs(memberId)).get(`/dialog/collection/edit/${entryId}`);
    assert.ok(!dialog.text.includes("future update"));
    assert.ok(dialog.text.includes(`hx-vals="{&quot;key&quot;:&quot;${keys[0]}&quot;}"`));
    assert.ok(dialog.text.includes(`hx-confirm="Remove this photo?"`));
  });
});

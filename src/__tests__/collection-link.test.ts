import { afterEach, beforeEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import request from "supertest";
import {
  addToCollection,
  linkCollectionEntry,
  updateCollectionEntry,
  removeFromCollection,
  CollectionRefusal,
  type CollectionRefusalCode,
} from "@/db/collection";
import { CaresRefusal, registerForCares, updateCaresPhoto, createFryShare } from "@/db/cares";
import { createMember } from "@/db/members";
import { media } from "@/services/media";
import { ImageValidationError } from "@/utils/image-processor";
import { overrideR2Client } from "@/utils/r2-client";
import { S3Client } from "@aws-sdk/client-s3";
import collectionRouter from "@/routes/collection";
import caresRouter from "@/routes/cares";
import type { MulmRequest } from "@/sessions";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";

void describe("collection linking and competing writers", () => {
  let fixture: TestDatabase;
  let memberId: number;
  let otherId: number;
  let speciesId: number;
  let entryId: number;

  beforeEach(async () => {
    fixture = await setupTestDatabase();
    memberId = await createMember("linker@example.test", "Linker", {}, true);
    otherId = await createMember("other@example.test", "Other");
    const result = await fixture.db.run(`INSERT INTO species_name_group
      (program_class, species_type, canonical_genus, canonical_species_name, is_cares_species)
      VALUES ('Livebearers', 'Fish', 'Linkus', 'testus', 1)`);
    speciesId = result.lastID!;
    entryId = await addToCollection(memberId, {
      common_name: "Custom name",
      scientific_name: "Custom scientific",
      notes: "Keep these notes",
      acquired_date: "2020-01-01",
      visibility: "private",
    });
    await fixture.db.run(
      "UPDATE species_collection SET images = ? WHERE id = ?",
      '[{"key":"existing-photo"}]',
      entryId
    );
    await fixture.db.run(
      `INSERT INTO cares_registration
      (member_id, species_group_id, photo_key, photo_url) VALUES (?, ?, 'registered-photo', 'https://photo')`,
      memberId,
      speciesId
    );
  });

  afterEach(async () => {
    mock.restoreAll();
    await fixture.cleanup();
  });

  const row = () => fixture.db.get("SELECT * FROM species_collection WHERE id = ?", entryId);
  const registration = () => fixture.db.all("SELECT * FROM cares_registration");
  const refusal = (code: CollectionRefusalCode) => (error: unknown) =>
    error instanceof CollectionRefusal && error.code === code;

  for (const code of [
    "missing",
    "forbidden",
    "already-linked",
    "missing-species",
    "duplicate",
  ] as const) {
    void test(`${code} refuses without changing entry or CARES registration`, async () => {
      if (code === "already-linked") await linkCollectionEntry(entryId, memberId, speciesId);
      if (code === "duplicate") await addToCollection(memberId, { group_id: speciesId });
      const before = await row();
      const registered = await registration();
      await assert.rejects(
        linkCollectionEntry(
          code === "missing" ? -1 : entryId,
          code === "forbidden" ? otherId : memberId,
          code === "missing-species" ? -1 : speciesId
        ),
        refusal(code)
      );
      assert.deepEqual(await row(), before);
      assert.deepEqual(await registration(), registered);
    });
  }

  void test("success clears custom names and preserves notes, photos, dates, visibility and CARES", async () => {
    const before = await row();
    const registered = await registration();
    await linkCollectionEntry(entryId, memberId, speciesId);
    const after = await row();
    assert.deepEqual(after, {
      ...before,
      group_id: speciesId,
      common_name: null,
      scientific_name: null,
      updated_at: after.updated_at,
    });
    assert.deepEqual(await registration(), registered);
  });

  void test("a write failure rolls back the entire link", async () => {
    const before = await row();
    await fixture.db.exec(`CREATE TRIGGER fail_link AFTER UPDATE OF group_id ON species_collection
      BEGIN SELECT RAISE(ABORT, 'link failed'); END`);
    await assert.rejects(linkCollectionEntry(entryId, memberId, speciesId), /link failed/);
    assert.deepEqual(await row(), before);
  });

  void test("link, add and re-add use the transaction connection for every decision", async () => {
    const prepare = fixture.db.prepare.bind(fixture.db);
    mock.method(fixture.db, "prepare", async (sql: string) => {
      // query() prepares a SELECT on the global reader. Transaction reads use db.get/all.
      if (/^\s*SELECT/i.test(sql)) throw new Error("global reader must not participate");
      return prepare(sql);
    });
    await linkCollectionEntry(entryId, memberId, speciesId);
    await removeFromCollection(entryId, memberId);
    await updateCollectionEntry(entryId, memberId, { removed_date: null });
    await removeFromCollection(entryId, memberId);
    await addToCollection(memberId, { group_id: speciesId });
  });

  for (const pair of [
    "link/link",
    "link/add",
    "add/link",
    "add/add",
    "link/re-add",
    "re-add/link",
    "add/re-add",
    "re-add/add",
    "re-add/re-add",
  ] as const) {
    void test(`${pair} admits only one current entry`, async () => {
      const custom2 = await addToCollection(memberId, { common_name: "Second custom" });
      const history1 = await addToCollection(memberId, { group_id: speciesId });
      await removeFromCollection(history1, memberId);
      const history2 = await addToCollection(memberId, { group_id: speciesId });
      // Distinct history dates avoid the legacy UNIQUE(member, Species, removed_date).
      await updateCollectionEntry(history2, memberId, { removed_date: "2020-01-01" });
      const operations = pair.split("/").map((kind, index) => () => {
        if (kind === "link")
          return linkCollectionEntry(index ? custom2 : entryId, memberId, speciesId);
        if (kind === "add") return addToCollection(memberId, { group_id: speciesId });
        return updateCollectionEntry(index ? history2 : history1, memberId, { removed_date: null });
      });
      const results = await Promise.allSettled(operations.map((run) => run()));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find((r) => r.status === "rejected");
      assert.ok(rejected?.status === "rejected" && refusal("duplicate")(rejected.reason));
      const current = await fixture.db.all(
        `SELECT id FROM species_collection
        WHERE member_id = ? AND group_id = ? AND removed_date IS NULL`,
        memberId,
        speciesId
      );
      assert.equal(current.length, 1);
    });
  }

  void test("concurrent links on the same entry refuse the second as already-linked", async () => {
    const results = await Promise.allSettled([
      linkCollectionEntry(entryId, memberId, speciesId),
      linkCollectionEntry(entryId, memberId, speciesId),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.ok(results[1].status === "rejected" && refusal("already-linked")(results[1].reason));
  });

  void test("concurrent CARES registrations produce a typed refusal and keep the winning photo", async () => {
    await fixture.db.run("DELETE FROM cares_registration");
    await linkCollectionEntry(entryId, memberId, speciesId);
    const results = await Promise.allSettled([
      registerForCares(entryId, memberId, "first", "first-url"),
      registerForCares(entryId, memberId, "second", "second-url"),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.ok(results[1].status === "rejected" && results[1].reason instanceof CaresRefusal);
    assert.equal(results[1].reason.code, "already-registered");
    const rows = await registration();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].photo_key, "first");
  });

  function appAs(id: number | undefined = memberId) {
    const app = express();
    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");
    app.use(express.urlencoded({ extended: false }));
    app.use((req: MulmRequest, _res, next) => {
      req.viewer = id
        ? { id, display_name: "Viewer", contact_email: "viewer@example.test", is_admin: true }
        : undefined;
      next();
    });
    app.use(collectionRouter);
    app.use(caresRouter);
    return app;
  }

  void test("real link route retains authentication, refusal statuses and HX-Refresh contract", async () => {
    const url = `/api/collection/${entryId}/link`;
    assert.equal(
      (await request(appAs(0)).post(url).type("form").send({ group_id: speciesId })).status,
      401
    );
    for (const [id, entry, species, status, message] of [
      [otherId, entryId, speciesId, 403, "Access denied"],
      [memberId, 999999, speciesId, 403, "Access denied"],
      [memberId, entryId, 999999, 400, "does not exist"],
      [memberId, entryId, "invalid", 400, "Invalid input"],
    ] as const) {
      const res = await request(appAs(id))
        .post(`/api/collection/${entry}/link`)
        .type("form")
        .send({ group_id: species });
      assert.equal(res.status, status);
      assert.match(res.text, new RegExp(message));
      assert.equal(res.headers["hx-refresh"], undefined);
    }
    const linked = await request(appAs()).post(url).type("form").send({ group_id: speciesId });
    assert.equal(linked.status, 200);
    assert.equal(linked.headers["hx-refresh"], "true");
    const second = await request(appAs()).post(url).type("form").send({ group_id: speciesId });
    assert.equal(second.status, 400);
    assert.match(second.text, /already linked/);
    assert.equal(second.headers["hx-refresh"], undefined);
    const custom2 = await addToCollection(memberId, { common_name: "Other custom" });
    const duplicate = await request(appAs())
      .post(`/api/collection/${custom2}/link`)
      .type("form")
      .send({ group_id: speciesId });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.text, /already have this species/);
  });

  void test("removing an already removed entry returns a typed client refusal", async () => {
    const first = await request(appAs()).delete(`/api/collection/${entryId}`);
    assert.equal(first.status, 200);
    const second = await request(appAs()).delete(`/api/collection/${entryId}`);
    assert.equal(second.status, 400);
    assert.match(second.text, /already removed/);
    const denied = await request(appAs(otherId)).delete(`/api/collection/${entryId}`);
    assert.equal(denied.status, 403);
  });

  void test("collection and CARES typed refusals are escaped and do not depend on wording", async () => {
    const payload = '<img src=x onerror="alert(1)">';
    mock.method(fixture.db, "get", async () => {
      throw new CollectionRefusal("missing-species", payload);
    });
    const res = await request(appAs())
      .post(`/api/collection/${entryId}/link`)
      .type("form")
      .send({ group_id: speciesId });
    assert.equal(res.status, 400);
    assert.match(res.text, /&lt;img/);
    assert.ok(!res.text.includes(payload));
    mock.restoreAll();
    mock.method(fixture.db, "all", async () => {
      throw new CaresRefusal("not-registered", payload);
    });
    const cares = await request(appAs()).post("/api/cares/fry-share").type("form").send({
      species_group_id: speciesId,
      recipient_name: "Friend",
      recipient_club: "Elsewhere",
      share_date: "2020-01-01",
    });
    assert.equal(cares.status, 400);
    assert.ok(!cares.text.includes(payload));
    assert.match(cares.text, /&lt;img/);
  });

  void test("unexpected failures with familiar business wording still return 500", async () => {
    mock.method(fixture.db, "get", async () => {
      throw new Error("already linked");
    });
    const link = await request(appAs())
      .post(`/api/collection/${entryId}/link`)
      .type("form")
      .send({ group_id: speciesId });
    assert.equal(link.status, 500);
    assert.equal(link.headers["hx-refresh"], undefined);
    mock.restoreAll();
    mock.method(fixture.db, "all", async () => {
      throw new Error("not registered");
    });
    const cares = await request(appAs()).post("/api/cares/fry-share").type("form").send({
      species_group_id: speciesId,
      recipient_name: "Friend",
      recipient_club: "Elsewhere",
      share_date: "2020-01-01",
    });
    assert.equal(cares.status, 500);
  });

  void test("CARES image validation messages render escaped HTML", async () => {
    await linkCollectionEntry(entryId, memberId, speciesId);
    overrideR2Client(
      new S3Client({
        region: "auto",
        credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
      }),
      {
        endpoint: "https://storage.invalid",
        accessKeyId: "fake",
        secretAccessKey: "fake",
        bucketName: "test",
        publicUrl: "https://images.test",
      }
    );
    mock.method(media, "upload", async () => {
      throw new ImageValidationError('<svg onload="alert(1)">');
    });
    const res = await request(appAs())
      .post(`/api/cares/${entryId}/photo`)
      .attach("photo", Buffer.from("invalid"), "fish.jpg");
    assert.equal(res.status, 400);
    assert.match(res.text, /&lt;svg/);
    assert.ok(!res.text.includes("<svg"));
  });

  void test("CARES refusal codes cover registration, photo replacement and fry shares", async () => {
    const caresCode = (code: string) => (error: unknown) =>
      error instanceof CaresRefusal && error.code === code;
    await assert.rejects(registerForCares(-1, memberId, "k", "u"), caresCode("missing-entry"));
    await assert.rejects(registerForCares(entryId, memberId, "k", "u"), caresCode("unlinked"));
    await linkCollectionEntry(entryId, memberId, speciesId);
    await assert.rejects(
      registerForCares(entryId, memberId, "k", "u"),
      caresCode("already-registered")
    );
    await fixture.db.run("DELETE FROM cares_registration");
    await assert.rejects(
      updateCaresPhoto(entryId, memberId, "k", "u"),
      caresCode("not-registered")
    );
    await assert.rejects(
      createFryShare(memberId, speciesId, "Friend", null, null, "2020-01-01", null),
      caresCode("not-registered")
    );
    await fixture.db.run(
      "UPDATE species_name_group SET is_cares_species = 0 WHERE group_id = ?",
      speciesId
    );
    await assert.rejects(registerForCares(entryId, memberId, "k", "u"), caresCode("ineligible"));
  });
});

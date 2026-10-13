import { afterEach, beforeEach, describe, test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { overrideR2Client } from "../utils/r2-client";
import { logger } from "../utils/logger";
import { setupTestDatabase, createTestSubmission, type TestDatabase } from "./testDbHelper.helper";
import { createMember } from "../db/members";
import { addToCollection } from "../db/collection";
import type { MulmRequest } from "../sessions";
import uploadRouter from "../routes/api/upload";
import collectionRouter from "../routes/collection";
import caresRouter from "../routes/cares";

void describe("image routes with real database and fake external storage", () => {
  let testDb: TestDatabase;
  let memberId: number;
  let submissionId: number;
  let entryId: number;
  let groupId: number;
  let photo: Buffer;
  let app: express.Express;
  let objects: Set<string>;
  let puts: string[];
  let deletes: string[];
  let failDeletes: boolean;
  let onPut: (key: string) => Promise<void>;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    memberId = await createMember("media@example.test", "Media member", {}, true);
    submissionId = await createTestSubmission(testDb.db, memberId);
    const species = await testDb.db.get<{ species_id: number }>(
      "SELECT species_id FROM submissions WHERE id = ?",
      submissionId
    );
    assert.ok(species);
    groupId = species.species_id;
    await testDb.db.run(
      "UPDATE species_name_group SET is_cares_species = 1 WHERE group_id = ?",
      groupId
    );
    entryId = await addToCollection(memberId, { group_id: groupId });
    photo = await sharp({ create: { width: 400, height: 400, channels: 3, background: "blue" } })
      .jpeg()
      .toBuffer();
    objects = new Set();
    puts = [];
    deletes = [];
    failDeletes = false;
    onPut = async () => {};
    const client = new S3Client({
      region: "auto",
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    });
    mock.method(client, "send", async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key!;
        puts.push(key);
        await onPut(key);
        objects.add(key);
      } else if (command instanceof DeleteObjectCommand) {
        const key = command.input.Key!;
        deletes.push(key);
        if (failDeletes) throw new Error("delete unavailable");
        objects.delete(key);
      } else throw new Error("Unexpected storage operation");
      return {};
    });
    overrideR2Client(client, {
      endpoint: "https://storage.invalid",
      accessKeyId: "fake",
      secretAccessKey: "fake",
      bucketName: "test",
      publicUrl: "https://images.test",
    });
    app = express();
    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");
    app.use((req: MulmRequest, _res, next) => {
      req.viewer = {
        id: memberId,
        display_name: "Media member",
        contact_email: "media@example.test",
        is_admin: true,
      };
      next();
    });
    app.use("/api/upload", uploadRouter);
    app.use(collectionRouter);
    app.use(caresRouter);
  });

  afterEach(async () => {
    mock.restoreAll();
    await testDb.cleanup();
  });

  void test("submission batch rolls back the earlier insert and compensates every variant on later insert failure", async () => {
    await testDb.db.exec(`CREATE TRIGGER fail_second_image BEFORE INSERT ON submission_images
      WHEN (SELECT COUNT(*) FROM submission_images) = 1 BEGIN SELECT RAISE(ABORT, 'second insert refused'); END`);
    const res = await request(app)
      .post("/api/upload/image")
      .field("submissionId", submissionId)
      .attach("images", photo, "one.jpg")
      .attach("images", photo, "two.jpg");
    assert.equal(res.status, 500);
    assert.match(res.body.message, /second insert refused/);
    assert.deepEqual(await testDb.db.all("SELECT * FROM submission_images"), []);
    assert.equal(puts.length, 6);
    assert.equal(objects.size, 0);
    assert.deepEqual(new Set(deletes), new Set(puts));
  });

  for (const family of ["submission", "collection"] as const) {
    void test(`${family} mixed valid/invalid files preserve partial-success JSON and persist only valid metadata`, async () => {
      const url =
        family === "submission" ? "/api/upload/image" : `/api/collection/${entryId}/images`;
      const res = await request(app)
        .post(url)
        .field("submissionId", submissionId)
        .attach("images", photo, "good.jpg")
        .attach("images", Buffer.from("not an image"), "bad.jpg");
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.images.length, 1);
      assert.match(res.body.errors[0], /^bad.jpg: Invalid image format/);
      if (family === "submission") {
        assert.match(res.body.uploadId, /^upload_/);
        const rows = await testDb.db.all("SELECT * FROM submission_images");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].r2_key, res.body.images[0].key);
      } else {
        const row = await testDb.db.get(
          "SELECT images FROM species_collection WHERE id = ?",
          entryId
        );
        assert.deepEqual(JSON.parse(row.images), res.body.images);
      }
      assert.equal(objects.size, 3);
      assert.equal(deletes.length, 0);
      assert.match(res.body.images[0].key, new RegExp(`^submissions/${memberId}/`));
    });
  }

  void test("collection persistence failure preserves existing metadata and cleans the new objects", async () => {
    await testDb.db.exec(`CREATE TRIGGER fail_images BEFORE UPDATE OF images ON species_collection
      BEGIN SELECT RAISE(ABORT, 'collection refused'); END`);
    const res = await request(app)
      .post(`/api/collection/${entryId}/images`)
      .attach("images", photo, "fish.jpg");
    assert.equal(res.status, 500);
    assert.equal(objects.size, 0);
    assert.equal(deletes.length, 3);
    const row = await testDb.db.get("SELECT images FROM species_collection WHERE id = ?", entryId);
    assert.ok(row.images === null || row.images === "[]");
  });

  void test("CARES initial registration persistence failure cleans every new object", async () => {
    await testDb.db.exec(`CREATE TRIGGER fail_registration BEFORE INSERT ON cares_registration
      BEGIN SELECT RAISE(ABORT, 'registration refused'); END`);
    const res = await request(app)
      .post("/api/cares/register")
      .field("collection_entry_id", entryId)
      .attach("photo", photo, "fish.jpg");
    assert.equal(res.status, 500);
    assert.deepEqual(await testDb.db.all("SELECT * FROM cares_registration"), []);
    assert.equal(objects.size, 0);
    assert.equal(deletes.length, 3);
  });

  void test("CARES refusal after uploading compensates the new photo", async () => {
    let removed = false;
    onPut = async () => {
      if (removed) return;
      removed = true;
      await testDb.db.run(
        "UPDATE species_collection SET removed_date = CURRENT_DATE WHERE id = ?",
        entryId
      );
    };
    const res = await request(app)
      .post("/api/cares/register")
      .field("collection_entry_id", entryId)
      .attach("photo", photo, "fish.jpg");
    assert.equal(res.status, 400);
    assert.match(res.text, /not found/);
    assert.deepEqual(await testDb.db.all("SELECT * FROM cares_registration"), []);
    assert.equal(objects.size, 0);
    assert.equal(deletes.length, 3);
  });

  void test("a partial storage failure is compensated while another file in the batch still commits", async () => {
    let firstStem: string | undefined;
    onPut = async (key) => {
      firstStem ??= key.replace(/-(original|medium|thumb)\.jpg$/, "");
      if (key === `${firstStem}-medium.jpg`) throw new Error("variant write refused");
      if (key === `${firstStem}-thumb.jpg`) await new Promise((resolve) => setTimeout(resolve, 25));
    };
    const res = await request(app)
      .post("/api/upload/image")
      .field("submissionId", submissionId)
      .attach("images", photo, "first.jpg")
      .attach("images", photo, "second.jpg");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.images.length, 1);
    assert.deepEqual(res.body.errors, ["first.jpg: Processing failed"]);
    assert.equal(objects.size, 3);
    assert.ok([...objects].every((key) => !key.startsWith(firstStem!)));
    const rows = await testDb.db.all("SELECT r2_key FROM submission_images");
    assert.deepEqual(rows, [{ r2_key: res.body.images[0].key }]);
  });

  async function registerOldPhoto() {
    const old = ["cares/old-original.jpg", "cares/old-medium.jpg", "cares/old-thumb.jpg"];
    old.forEach((key) => objects.add(key));
    await testDb.db.run(
      "INSERT INTO cares_registration (member_id, species_group_id, photo_key, photo_url) VALUES (?, ?, ?, ?)",
      memberId,
      groupId,
      old[0],
      "https://images.test/old"
    );
    return old;
  }

  void test("unsuccessful CARES replacement retains the previous record and all old variants", async () => {
    const old = await registerOldPhoto();
    await testDb.db.exec(`CREATE TRIGGER fail_photo BEFORE UPDATE OF photo_key ON cares_registration
      BEGIN SELECT RAISE(ABORT, 'replacement refused'); END`);
    const res = await request(app)
      .post(`/api/cares/${entryId}/photo`)
      .attach("photo", photo, "fish.jpg");
    assert.equal(res.status, 500);
    assert.deepEqual(objects, new Set(old));
    const row = await testDb.db.get("SELECT photo_key, photo_url FROM cares_registration");
    assert.equal(row.photo_key, old[0]);
    assert.equal(row.photo_url, "https://images.test/old");
    assert.equal(deletes.length, 3);
    assert.ok(deletes.every((key) => !old.includes(key)));
  });

  void test("successful CARES replacement commits its new photo before deleting the previous variants", async () => {
    const old = await registerOldPhoto();
    onPut = async () => {
      const row = await testDb.db.get("SELECT photo_key FROM cares_registration");
      assert.equal(row.photo_key, old[0]);
      assert.ok(old.every((key) => objects.has(key)));
    };
    const res = await request(app)
      .post(`/api/cares/${entryId}/photo`)
      .attach("photo", photo, "fish.jpg");
    assert.equal(res.status, 200);
    assert.match(res.text, /CARES photo updated!/);
    const row = await testDb.db.get("SELECT photo_key FROM cares_registration");
    assert.match(row.photo_key, new RegExp(`^cares/${memberId}/${entryId}/`));
    assert.ok(objects.has(row.photo_key));
    assert.equal(objects.size, 3);
    assert.deepEqual(new Set(deletes), new Set(old));
  });

  void test("CARES registration succeeds and duplicate registration refuses before writing objects", async () => {
    const register = () =>
      request(app)
        .post("/api/cares/register")
        .field("collection_entry_id", entryId)
        .attach("photo", photo, "fish.jpg");
    assert.equal((await register()).status, 200);
    assert.equal(objects.size, 3);
    const row = await testDb.db.get("SELECT photo_key FROM cares_registration");
    assert.ok(objects.has(row.photo_key));
    const duplicate = await register();
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.text, /already registered/);
    assert.equal(puts.length, 3);
  });

  void test("CARES checks ownership before either registration or replacement uploads", async () => {
    const stranger = await createMember("stranger@example.test", "Stranger");
    const theirEntry = await addToCollection(stranger, { group_id: groupId });
    const registration = await request(app)
      .post("/api/cares/register")
      .field("collection_entry_id", theirEntry)
      .attach("photo", photo, "fish.jpg");
    const replacement = await request(app)
      .post(`/api/cares/${theirEntry}/photo`)
      .attach("photo", photo, "fish.jpg");
    assert.equal(registration.status, 400);
    assert.equal(replacement.status, 400);
    assert.equal(puts.length, 0);
  });

  void test("cleanup deletion failure remains observable while the response preserves the persistence failure", async () => {
    const log = mock.method(logger, "error", () => {});
    failDeletes = true;
    await testDb.db.exec(`CREATE TRIGGER fail_image BEFORE INSERT ON submission_images
      BEGIN SELECT RAISE(ABORT, 'initiating database failure'); END`);
    const res = await request(app)
      .post("/api/upload/image")
      .field("submissionId", submissionId)
      .attach("images", photo, "fish.jpg");
    assert.equal(res.status, 500);
    assert.match(res.body.message, /initiating database failure/);
    assert.deepEqual(await testDb.db.all("SELECT * FROM submission_images"), []);
    assert.equal(deletes.length, 3);
    assert.equal(
      log.mock.calls.filter((call) => call.arguments[0] === "Failed to clean up image variant")
        .length,
      3
    );
  });
});

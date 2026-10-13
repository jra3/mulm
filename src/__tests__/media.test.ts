import { test, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createMediaService, type MediaStorage } from "../services/media";
import { logger } from "../utils/logger";

let photo: Buffer;
before(async () => {
  photo = await sharp({ create: { width: 400, height: 400, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
});

void test("variant failure waits for a delayed sibling, compensates attempted writes, and preserves the error", async () => {
  const objects = new Set<string>();
  const deleted: string[] = [];
  const originalError = new Error("middle write failed");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const siblingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const storage: MediaStorage = {
    publicUrl: (key) => `https://images.test/${key}`,
    put: async (key) => {
      if (key.includes("-medium")) throw originalError;
      if (key.includes("-thumb")) {
        started();
        await gate;
      }
      objects.add(key);
    },
    delete: async (key) => {
      deleted.push(key);
      objects.delete(key);
    },
  };
  const service = createMediaService({ storage, key: () => "test.jpg" });
  const result = service.upload(photo, {
    scope: "submissions",
    memberId: 1,
    recordId: 2,
    filename: "fish.jpg",
  });
  const rejection = assert.rejects(result, (error) => error === originalError);
  await siblingStarted;
  assert.equal(deleted.length, 0, "cleanup must not race a running write");
  release();
  await rejection;
  assert.equal(objects.size, 0);
  assert.deepEqual(deleted.sort(), ["test-medium.jpg", "test-original.jpg", "test-thumb.jpg"]);
});

void test("cleanup failures are logged with the owned key and do not replace the upload failure", async (t) => {
  const originalError = new Error("write failed");
  const cleanupError = new Error("delete failed");
  const log = t.mock.method(logger, "error", () => {});
  const service = createMediaService({
    key: () => "test.jpg",
    storage: {
      publicUrl: (key) => key,
      put: async (key) => {
        if (key.includes("-medium")) throw originalError;
      },
      delete: async () => {
        throw cleanupError;
      },
    },
  });
  await assert.rejects(
    service.upload(photo, { scope: "cares", memberId: 1, recordId: 2, filename: "fish.jpg" }),
    (error) => error === originalError
  );
  assert.equal(log.mock.callCount(), 3);
  assert.deepEqual(log.mock.calls[0].arguments, [
    "Failed to clean up image variant",
    { key: "test-original.jpg", error: cleanupError },
  ]);
});

void test("successful media exposes deterministic metadata, distinct variant keys, and explicit cleanup", async () => {
  const objects = new Map<string, string>();
  const service = createMediaService({
    key: () => "cares/1/2/fish.webp",
    now: () => new Date("2026-01-02T00:00:00Z"),
    storage: {
      publicUrl: (key) => `https://images.test/${key}`,
      put: async (key, _buffer, type) => {
        objects.set(key, type);
      },
      delete: async (key) => {
        objects.delete(key);
      },
    },
  });
  const uploaded = await service.upload(
    photo,
    { scope: "cares", memberId: 1, recordId: 2, filename: "fish.webp" },
    { preferWebP: true }
  );
  assert.equal(objects.size, 3);
  assert.equal(uploaded.metadata.key, "cares/1/2/fish-original.webp");
  assert.equal(uploaded.metadata.contentType, "image/webp");
  assert.equal(uploaded.metadata.uploadedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(uploaded.metadata.url, "https://images.test/cares/1/2/fish-original.webp");
  assert.ok(uploaded.metadata.size > 0);
  assert.ok([...objects.values()].every((type) => type === "image/webp"));
  await uploaded.cleanup();
  assert.equal(objects.size, 0);
});

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import path from "path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import * as species from "@/routes/species";
import * as admin from "@/routes/admin";
import { createMember } from "@/db/members";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";

/**
 * Handlers rendered through the real Express view engine, so a missing
 * view or a view variable the handler forgot fails here instead of 500ing.
 */
function appWith(mount: (app: express.Express) => void, viewer?: MulmRequest["viewer"]) {
  const app = express();
  app.set("views", path.join(__dirname, "../views"));
  app.set("view engine", "pug");
  app.use((req: MulmRequest, _res, next) => {
    req.viewer = viewer;
    next();
  });
  mount(app);
  return app;
}

void describe("Species detail errors", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  void test("a non-numeric id is a 404 page, not a 500", async () => {
    const app = appWith((a) => a.get("/species/:groupId", species.detail));

    const res = await request(app).get("/species/abc");

    assert.strictEqual(res.status, 404);
    assert.match(res.text, /Species not found/);
  });

  void test("an unknown id is a 404 page", async () => {
    const app = appWith((a) => a.get("/species/:groupId", species.detail));

    const res = await request(app).get("/species/999999");

    assert.strictEqual(res.status, 404);
    assert.match(res.text, /Species not found/);
  });
});

void describe("Send Welcome", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  void test("returns the member's row after sending", async () => {
    const memberId = await createMember("invitee@example.com", "Invited Member");
    const app = appWith((a) => a.post("/admin/members/:memberId/send-welcome", admin.sendWelcomeEmail));

    const res = await request(app).post(`/admin/members/${memberId}/send-welcome`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /Invited Member/);
  });

  const credentialCases: [string, Parameters<typeof createMember>[2]][] = [
    ["Apple", { apple_sub: "apple-sub-1" }],
    ["Google", { google_sub: "google-sub-1" }],
    ["a password", { password: "correct horse battery staple" }],
  ];
  for (const [kind, credentials] of credentialCases) {
    void test(`refuses a member who signs in with ${kind}`, async () => {
      const memberId = await createMember("signed-in@example.com", "Signed In Member", credentials);
      const app = appWith((a) => a.post("/admin/members/:memberId/send-welcome", admin.sendWelcomeEmail));

      const res = await request(app).post(`/admin/members/${memberId}/send-welcome`);

      assert.strictEqual(res.status, 400);
      assert.match(res.text, /already has login credentials/);
    });
  }
});

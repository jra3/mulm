import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import path from "path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import caresRouter from "@/routes/cares";
import * as member from "@/routes/member";
import * as species from "@/routes/species";
import { exposeCaresRegistry } from "@/caresRegistry";
import { createMember } from "@/db/members";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";

/**
 * The CARES registry is in development, so only admins see it. CARES species
 * badges are a fact about the Species and stay visible to everyone.
 */
function appAs(viewer?: MulmRequest["viewer"]) {
  const app = express();
  app.set("views", path.join(__dirname, "../views"));
  app.set("view engine", "pug");
  app.use((req: MulmRequest, _res, next) => {
    req.viewer = viewer;
    next();
  });
  app.use(exposeCaresRegistry);
  app.get("/member/:memberId", member.view);
  app.get("/member/:memberId/collection", member.viewCollection);
  app.get("/species", species.explorer);
  app.get("/species/:groupId", species.detail);
  app.use("/", caresRouter);
  return app;
}

void describe("CARES registry visibility", () => {
  let testDb: TestDatabase;
  let keeperId: number;
  let groupId: number;
  let viewers: Record<"anonymous" | "member" | "admin", MulmRequest["viewer"]>;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    const db = testDb.db;
    keeperId = await createMember("keeper@example.com", "Keeper");
    const adminId = await createMember("admin@example.com", "Admin", {}, true);
    const species = await db.run(`
      INSERT INTO species_name_group (
        program_class, species_type, canonical_genus, canonical_species_name,
        base_points, is_cares_species
      ) VALUES ('Livebearers', 'Fish', 'Xenotoca', 'testcares', 10, 1)
    `);
    groupId = species.lastID as number;
    await db.run(
      `INSERT INTO species_collection (member_id, group_id, common_name, cares_registered_at, visibility)
       VALUES (?, ?, 'Test Splitfin', '2026-01-01', 'public')`,
      [keeperId, groupId]
    );
    viewers = {
      anonymous: undefined,
      member: { id: keeperId, display_name: "Keeper", contact_email: "keeper@example.com" },
      admin: {
        id: adminId,
        display_name: "Admin",
        contact_email: "admin@example.com",
        is_admin: true,
      },
    };
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  for (const who of ["anonymous", "member"] as const) {
    void describe(`for ${who === "anonymous" ? "an anonymous visitor" : "a member"}`, () => {
      void test("the CARES pages and endpoints are not found", async () => {
        const app = appAs(viewers[who]);
        for (const url of [
          "/cares",
          "/dialog/cares/fry-share",
          `/dialog/cares/register/1`,
          `/api/cares/registrations/${keeperId}`,
        ]) {
          const res = await request(app).get(url);
          assert.strictEqual(res.status, 404, url);
        }
        const post = await request(app).post("/api/cares/fry-share").send({});
        assert.strictEqual(post.status, 404);
      });

      void test("the nav has no CARES link", async () => {
        const res = await request(appAs(viewers[who])).get("/species");
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.text, /href="\/cares"/);
      });

      void test("the profile has no CARES section", async () => {
        const res = await request(appAs(viewers[who])).get(`/member/${keeperId}`);
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.text, /C\.A\.R\.E\.S\. Program/);
      });

      void test("collection cards show no registration", async () => {
        const res = await request(appAs(viewers[who])).get(`/member/${keeperId}/collection`);
        assert.strictEqual(res.status, 200);
        assert.doesNotMatch(res.text, /CARES Registered/);
        assert.doesNotMatch(res.text, /\/dialog\/cares\//);
      });

      void test("species pages keep the CARES badge but drop the registry", async () => {
        const app = appAs(viewers[who]);
        const detail = await request(app).get(`/species/${groupId}`);
        assert.strictEqual(detail.status, 200);
        assert.match(detail.text, /caresforfish\.org/);
        assert.doesNotMatch(detail.text, /maintaining this species/);

        const explorer = await request(app).get("/species?cares_only=true");
        assert.strictEqual(explorer.status, 200);
        assert.doesNotMatch(explorer.text, /Coverage Dashboard/);
      });
    });
  }

  void describe("for an admin", () => {
    void test("everything is still there", async () => {
      const app = appAs(viewers.admin);

      const landing = await request(app).get("/cares");
      assert.strictEqual(landing.status, 200);
      assert.match(landing.text, /href="\/cares"/);

      const profile = await request(app).get(`/member/${keeperId}`);
      assert.match(profile.text, /C\.A\.R\.E\.S\. Program/);

      const collection = await request(app).get(`/member/${keeperId}/collection`);
      assert.match(collection.text, /CARES Registered/);

      const detail = await request(app).get(`/species/${groupId}`);
      assert.match(detail.text, /maintaining this species/);

      const explorer = await request(app).get("/species?cares_only=true");
      assert.match(explorer.text, /Coverage Dashboard/);
    });
  });
});

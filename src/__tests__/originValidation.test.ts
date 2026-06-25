import { describe, test, beforeEach } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import { createOriginValidation, buildAllowedOrigins } from "../middleware/originValidation";

const ALLOWED = "https://bap.basny.org";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createOriginValidation({ allowedOrigins: [ALLOWED] }));
  // Echo handlers for every method we care about.
  const ok = (_req: express.Request, res: express.Response) => res.status(200).send("ok");
  app.get("/thing", ok);
  app.post("/thing", ok);
  app.patch("/thing", ok);
  app.delete("/thing", ok);
  app.put("/thing", ok);
  return app;
}

void describe("Origin/Referer validation middleware", () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeApp();
  });

  void describe("state-changing requests", () => {
    void test("allows POST with an allowlisted Origin", async () => {
      await request(app).post("/thing").set("Origin", ALLOWED).expect(200);
    });

    void test("rejects POST with a cross-origin Origin", async () => {
      const res = await request(app).post("/thing").set("Origin", "https://evil.example.com");
      assert.strictEqual(res.status, 403);
    });

    void test("rejects POST from a sibling subdomain (SameSite carve-out)", async () => {
      const res = await request(app).post("/thing").set("Origin", "https://evil.basny.org");
      assert.strictEqual(res.status, 403);
    });

    void test("rejects a literal 'null' Origin", async () => {
      const res = await request(app).post("/thing").set("Origin", "null");
      assert.strictEqual(res.status, 403);
    });

    void test("rejects when both Origin and Referer are absent", async () => {
      const res = await request(app).post("/thing");
      assert.strictEqual(res.status, 403);
    });

    void test("falls back to an allowlisted Referer when Origin is absent", async () => {
      await request(app).post("/thing").set("Referer", `${ALLOWED}/some/page`).expect(200);
    });

    void test("rejects a cross-origin Referer when Origin is absent", async () => {
      const res = await request(app).post("/thing").set("Referer", "https://evil.example.com/page");
      assert.strictEqual(res.status, 403);
    });

    void test("rejects a malformed Referer", async () => {
      const res = await request(app).post("/thing").set("Referer", "not a url");
      assert.strictEqual(res.status, 403);
    });

    void test("prefers Origin over Referer (bad Origin rejected even with good Referer)", async () => {
      const res = await request(app)
        .post("/thing")
        .set("Origin", "https://evil.example.com")
        .set("Referer", `${ALLOWED}/page`);
      assert.strictEqual(res.status, 403);
    });

    void test("allows same-origin requests via the request's own host", async () => {
      // No static allowlist entry for example.com; matched via self-origin.
      await request(app)
        .post("/thing")
        .set("Host", "example.com")
        .set("Origin", "http://example.com")
        .expect(200);
    });

    void test("applies to PATCH", async () => {
      await request(app).patch("/thing").set("Origin", ALLOWED).expect(200);
      const res = await request(app).patch("/thing").set("Origin", "https://evil.example.com");
      assert.strictEqual(res.status, 403);
    });

    void test("applies to DELETE", async () => {
      await request(app).delete("/thing").set("Origin", ALLOWED).expect(200);
      const res = await request(app).delete("/thing").set("Origin", "https://evil.example.com");
      assert.strictEqual(res.status, 403);
    });

    void test("applies to PUT", async () => {
      await request(app).put("/thing").set("Origin", ALLOWED).expect(200);
      const res = await request(app).put("/thing").set("Origin", "https://evil.example.com");
      assert.strictEqual(res.status, 403);
    });
  });

  void describe("safe methods", () => {
    void test("GET is never checked, even cross-origin", async () => {
      await request(app).get("/thing").set("Origin", "https://evil.example.com").expect(200);
    });

    void test("GET with no headers passes", async () => {
      await request(app).get("/thing").expect(200);
    });
  });

  void describe("buildAllowedOrigins", () => {
    void test("includes localhost variants in non-production", () => {
      // Tests run with NODE_ENV=test.
      const origins = buildAllowedOrigins();
      assert.ok(origins.has("http://localhost:4200"));
      assert.ok(origins.has("http://127.0.0.1:4200"));
    });

    void test("honors the ALLOWED_ORIGINS env override", () => {
      const prev = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "https://staging.example.com, https://preview.example.com";
      try {
        const origins = buildAllowedOrigins();
        assert.ok(origins.has("https://staging.example.com"));
        assert.ok(origins.has("https://preview.example.com"));
      } finally {
        if (prev === undefined) {
          delete process.env.ALLOWED_ORIGINS;
        } else {
          process.env.ALLOWED_ORIGINS = prev;
        }
      }
    });
  });
});

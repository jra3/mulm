import { describe, test, beforeEach } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import { csrfValidation } from "../middleware/csrfValidation";
import { MulmRequest } from "../sessions";

const TOKEN = "valid-session-token";

/**
 * Build an app where a query flag drives the simulated auth state:
 *   ?auth=1        -> authenticated with a csrf_token
 *   ?auth=notoken  -> authenticated but no stored token (legacy session)
 *   (default)      -> unauthenticated
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req: MulmRequest, _res, next) => {
    const auth = req.query.auth;
    if (auth === "1") {
      req.viewer = { id: 7, display_name: "T", contact_email: "t@e.com" };
      req.csrfToken = TOKEN;
    } else if (auth === "notoken") {
      req.viewer = { id: 7, display_name: "T", contact_email: "t@e.com" };
    }
    next();
  });
  app.use(csrfValidation);
  const ok = (_req: express.Request, res: express.Response) => res.status(200).send("ok");
  app.get("/thing", ok);
  app.post("/thing", ok);
  app.patch("/thing", ok);
  app.delete("/thing", ok);
  return app;
}

void describe("CSRF token validation middleware", () => {
  let app: express.Application;

  beforeEach(() => {
    app = makeApp();
  });

  void test("allows an authenticated POST with a matching X-CSRF-Token header", async () => {
    await request(app).post("/thing?auth=1").set("X-CSRF-Token", TOKEN).expect(200);
  });

  void test("allows an authenticated POST with a matching _csrf body field", async () => {
    await request(app)
      .post("/thing?auth=1")
      .send({ _csrf: TOKEN })
      .expect(200);
  });

  void test("rejects an authenticated POST with no token", async () => {
    const res = await request(app).post("/thing?auth=1");
    assert.strictEqual(res.status, 403);
  });

  void test("rejects an authenticated POST with a wrong token", async () => {
    const res = await request(app).post("/thing?auth=1").set("X-CSRF-Token", "nope");
    assert.strictEqual(res.status, 403);
  });

  void test("skips unauthenticated requests (covered by Origin validation)", async () => {
    await request(app).post("/thing").expect(200);
  });

  void test("does not block authenticated sessions that have no stored token", async () => {
    await request(app).post("/thing?auth=notoken").expect(200);
  });

  void test("ignores safe methods even when authenticated", async () => {
    await request(app).get("/thing?auth=1").expect(200);
  });

  void test("applies to PATCH", async () => {
    await request(app).patch("/thing?auth=1").set("X-CSRF-Token", TOKEN).expect(200);
    const res = await request(app).patch("/thing?auth=1");
    assert.strictEqual(res.status, 403);
  });

  void test("applies to DELETE", async () => {
    await request(app).delete("/thing?auth=1").set("X-CSRF-Token", TOKEN).expect(200);
    const res = await request(app).delete("/thing?auth=1");
    assert.strictEqual(res.status, 403);
  });
});

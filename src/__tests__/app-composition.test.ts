import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import request from "supertest";
import { createApp } from "../app";
import { getAppleConfig } from "../auth/apple";
import { createMember } from "../db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

void test("factory and bootstrap imports and app construction need no initialized services and exit naturally", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      path.join(__dirname, "helpers/app-lifecycle/preload.ts"),
      path.join(__dirname, "helpers/app-lifecycle/import.ts"),
    ],
    {
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 15_000,
    }
  );
  assert.match(output, /APP_CONSTRUCTION_COMPLETE/);
});

void describe("production app composition with SQLite", () => {
  let fixture: TestDatabase;
  let memberId: number;
  const email = "composition@example.test";
  const password = "Good test password 42!";
  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember(email, "Composition Member", { password });
  });
  afterEach(async () => fixture.cleanup());

  void test("public, anonymous protected, authenticated, admin and HTMX routes share the real stack", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    const agent = request.agent(app);
    await agent.get("/").expect(200);
    await agent.get("/account").expect(401);
    await agent.get("/admin/members").expect(401);
    const login = await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email, password })
      .expect(200);
    assert.equal(login.headers["hx-redirect"], "/");
    assert.match(String(login.headers["set-cookie"]), /session_id=.*HttpOnly.*SameSite=Lax/);
    await agent.get("/me").expect(302).expect("Location", `/member/${memberId}`);
    const account = await agent.get("/account").expect(200);
    assert.match(account.text, /Composition Member/);
    assert.match(account.text, /name="csrf-token"/);
    await agent.get("/admin/members").expect(403);
    const fragment = await agent.get("/annual?year=2026").set("HX-Request", "true").expect(200);
    assert.equal(fragment.headers["hx-redirect"], "/annual/2026");
    await fixture.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", memberId);
    await agent.get("/admin/members").expect(200);
  });

  void test("Origin and session CSRF checks precede mutations, while valid CSRF logs out and deletes the session", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ email, password }).expect(403);
    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .send({ email, password })
      .expect(200);
    const session = await fixture.db.get<{ csrf_token: string }>(
      "SELECT csrf_token FROM sessions WHERE member_id = ?",
      memberId
    );
    assert.ok(session);
    await agent
      .post("/auth/logout")
      .set("Origin", "http://evil.example")
      .set("X-CSRF-Token", session.csrf_token)
      .expect(403);
    await agent.post("/auth/logout").set("Origin", "http://localhost:4200").expect(403);
    await agent
      .post("/auth/logout")
      .set("Origin", "http://localhost:4200")
      .set("X-CSRF-Token", "wrong")
      .expect(403);
    await agent.get("/account").expect(200);
    const logout = await agent
      .post("/auth/logout")
      .set("Origin", "http://localhost:4200")
      .set("X-CSRF-Token", session.csrf_token)
      .expect(200);
    assert.equal(logout.headers["hx-redirect"], "/");
    assert.equal(
      await fixture.db.get("SELECT 1 FROM sessions WHERE member_id = ?", memberId),
      undefined
    );
    await agent.get("/account").expect(401);
  });

  void test("explicit production env controls proxy, secure cookie creation/parsing/clearing and dev guards", async () => {
    const app = createApp({
      env: { NODE_ENV: "production", STAGING: "1" },
      config: {
        server: { domain: "portal.example.test" },
        email: { bugReportEmail: "bugs@example.test" },
      },
    });
    assert.equal(app.get("trust proxy"), 1);
    const login = await request(app)
      .post("/auth/login")
      .set("Host", "proxy.example.test")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://proxy.example.test")
      .send({ email, password })
      .expect(200);
    const cookies: string[] = login.headers["set-cookie"] as unknown as string[];
    assert.ok(cookies[0].startsWith("__Host-session_id="));
    assert.match(cookies[0], /; Secure/);
    assert.doesNotMatch(cookies[0], /; Domain=/);
    assert.ok(login.headers["strict-transport-security"]);
    const cookie = cookies[0].split(";")[0];
    await request(app)
      .get("/me")
      .set("Cookie", cookie)
      .expect(302)
      .expect("Location", `/member/${memberId}`);
    await request(app)
      .get("/account")
      .set("Cookie", cookie.replace("__Host-session_id", "session_id"))
      .expect(401);
    await request(app).get("/test-login").expect(404);
    const session = await fixture.db.get<{ csrf_token: string }>(
      "SELECT csrf_token FROM sessions WHERE member_id = ?",
      memberId
    );
    assert.ok(session);
    const logout = await request(app)
      .post("/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://portal.example.test")
      .send({ _csrf: session.csrf_token })
      .expect(200);
    assert.match(String(logout.headers["set-cookie"]), /__Host-session_id=;.*Secure/);
  });

  void test("CSP report and Apple callback retain their deliberate pre-CSRF mount order", async () => {
    const app = createApp({ env: { NODE_ENV: "test" } });
    await request(app).post("/csp-report").send({ "csp-report": {} }).expect(204);
    const callback = await request(app)
      .post("/oauth/apple")
      .send({})
      .expect(getAppleConfig() ? 400 : 404);
    assert.doesNotMatch(callback.text, /invalid request origin/);
    const missing = await request(app).get("/missing-route").expect(404);
    assert.equal(missing.headers["x-powered-by"], undefined);
    assert.equal(missing.headers["x-frame-options"], "DENY");
  });
});

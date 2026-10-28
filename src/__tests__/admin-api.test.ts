import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import {
  AdminTokenError,
  createAdminToken,
  listAdminTokens,
  revokeAdminToken,
  verifyAdminToken,
} from "../db/adminTokens";
import { createMember } from "../db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

const password = "Good test password 42!";
const email = "api-admin@example.test";

let fixture: TestDatabase;
let adminId: number;
let memberId: number;

beforeEach(async () => {
  fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
  adminId = await createMember(email, "Api Admin", { password });
  await fixture.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", adminId);
  memberId = await createMember("api-member@example.test", "Api Member");
});
afterEach(async () => fixture.cleanup());

void describe("admin API tokens", () => {
  void test("a minted token verifies, is stored only as a hash and records its last use", async () => {
    const { token, record } = await createAdminToken(adminId, "laptop");
    assert.match(token, /^basny_[A-Za-z0-9_-]{43}$/);
    const stored = await fixture.db.get<{ token_hash: string; last_used_at: string | null }>(
      "SELECT token_hash, last_used_at FROM admin_api_tokens WHERE id = ?",
      record.id
    );
    assert.ok(stored);
    assert.notEqual(stored.token_hash, token);
    assert.ok(!stored.token_hash.includes(token.slice(6)));
    assert.equal(stored.last_used_at, null);

    const result = await verifyAdminToken(token);
    assert.ok(result.ok);
    assert.equal(result.actor.member.id, adminId);
    assert.equal(result.actor.token.id, record.id);
    const used = await fixture.db.get<{ last_used_at: string | null }>(
      "SELECT last_used_at FROM admin_api_tokens WHERE id = ?",
      record.id
    );
    assert.ok(used?.last_used_at);
  });

  void test("minting refuses a member who is not an admin, an unknown member and a blank name", async () => {
    await assert.rejects(createAdminToken(memberId, "x"), AdminTokenError);
    await assert.rejects(createAdminToken(999_999, "x"), AdminTokenError);
    await assert.rejects(createAdminToken(adminId, "  "), AdminTokenError);
    await assert.rejects(createAdminToken(adminId, "x", { expiresInDays: 0 }), AdminTokenError);
    const count = await fixture.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM admin_api_tokens");
    assert.equal(count?.n, 0);
  });

  void test("unknown and malformed tokens are invalid", async () => {
    await createAdminToken(adminId, "laptop");
    assert.deepEqual(await verifyAdminToken("basny_" + "A".repeat(43)), {
      ok: false,
      reason: "invalid",
    });
    assert.deepEqual(await verifyAdminToken("nonsense"), { ok: false, reason: "invalid" });
  });

  void test("a revoked token stops verifying, and revoking twice reports nothing to do", async () => {
    const { token, record } = await createAdminToken(adminId, "laptop");
    assert.equal(await revokeAdminToken(record.id), true);
    assert.equal(await revokeAdminToken(record.id), false);
    assert.equal(await revokeAdminToken(424242), false);
    assert.deepEqual(await verifyAdminToken(token), { ok: false, reason: "invalid" });
    const [listed] = await listAdminTokens();
    assert.ok(listed.revoked_at);
    assert.equal(listed.contact_email, email);
  });

  void test("a token expires after its days", async () => {
    const minted = new Date("2026-01-01T00:00:00Z");
    const { token, record } = await createAdminToken(adminId, "short", {
      expiresInDays: 2,
      now: minted,
    });
    assert.equal(record.expires_at, "2026-01-03T00:00:00.000Z");
    assert.ok((await verifyAdminToken(token, new Date("2026-01-02T23:59:59Z"))).ok);
    assert.deepEqual(await verifyAdminToken(token, new Date("2026-01-03T00:00:00Z")), {
      ok: false,
      reason: "invalid",
    });
  });

  void test("a token whose member is no longer an admin is refused", async () => {
    const { token } = await createAdminToken(adminId, "laptop");
    await fixture.db.run("UPDATE members SET is_admin = 0 WHERE id = ?", adminId);
    assert.deepEqual(await verifyAdminToken(token), { ok: false, reason: "not_admin" });
  });
});

void describe("/api/admin", () => {
  const app = () => createApp({ env: { NODE_ENV: "test" } });

  void test("whoami returns the token's admin and the token, without its secret", async () => {
    const { token, record } = await createAdminToken(adminId, "laptop", { expiresInDays: 30 });
    const res = await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect("Content-Type", /json/);
    assert.deepEqual(res.body, {
      member: { id: adminId, display_name: "Api Admin" },
      token: {
        id: record.id,
        name: "laptop",
        created_at: record.created_at,
        expires_at: record.expires_at,
      },
    });
  });

  void test("no token, a wrong scheme, a bad token and a revoked token are 401 JSON", async () => {
    const { token, record } = await createAdminToken(adminId, "laptop");
    const missing = await request(app()).get("/api/admin/whoami").expect(401);
    assert.equal(missing.body.error, "unauthorized");
    assert.match(String(missing.headers["www-authenticate"]), /^Bearer/);
    await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", `Basic ${token}`)
      .expect(401);
    await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", "Bearer basny_" + "B".repeat(43))
      .expect(401);
    await revokeAdminToken(record.id);
    const revoked = await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    assert.equal(revoked.body.error, "unauthorized");
  });

  void test("a demoted admin's token is refused at request time with 403", async () => {
    const { token } = await createAdminToken(adminId, "laptop");
    await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await fixture.db.run("UPDATE members SET is_admin = 0 WHERE id = ?", adminId);
    const res = await request(app())
      .get("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    assert.equal(res.body.error, "forbidden");
  });

  void test("an admin's session cookie, even with its CSRF token, does not authenticate the API", async () => {
    const agent = request.agent(app());
    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email, password })
      .expect(200);
    await agent.get("/admin/members").expect(200);
    const session = await fixture.db.get<{ csrf_token: string }>(
      "SELECT csrf_token FROM sessions WHERE member_id = ?",
      adminId
    );
    assert.ok(session);
    const res = await agent.get("/api/admin/whoami").expect(401);
    assert.equal(res.body.error, "unauthorized");
    await agent
      .post("/api/admin/whoami")
      .set("Origin", "http://localhost:4200")
      .set("X-CSRF-Token", session.csrf_token)
      .send({})
      .expect(401);
  });

  void test("a bearer request needs no Origin or CSRF token, even alongside a session cookie", async () => {
    const { token } = await createAdminToken(adminId, "laptop");
    const agent = request.agent(app());
    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email, password })
      .expect(200);
    // A state-changing request with no Origin and no CSRF token gets past
    // authentication to routing: 404 for want of a POST endpoint, not 403.
    const res = await agent
      .post("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .send({ any: "thing" })
      .expect(404);
    assert.equal(res.body.error, "not_found");
  });

  void test("malformed JSON is a 400 JSON error once authenticated", async () => {
    const { token } = await createAdminToken(adminId, "laptop");
    const res = await request(app())
      .post("/api/admin/whoami")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
    assert.equal(res.body.error, "bad_request");
  });
});

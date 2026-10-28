import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import { createAdminToken } from "../db/adminTokens";
import { createMember } from "../db/members";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { createRawSubmissionFixture } from "./helpers/fixtures";

const password = "Good test password 42!";
const adminEmail = "api-admin@example.test";

let fixture: TestDatabase;
let adminId: number;
let token: string;

const app = () => createApp({ env: { NODE_ENV: "test" } });
const auth = (bearer = token) => ({ Authorization: `Bearer ${bearer}` });

async function makeAdmin(id: number) {
  await fixture.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", id);
}

async function tokenState(id: number) {
  return fixture.db.get<{ revoked_at: string | null }>(
    "SELECT revoked_at FROM admin_api_tokens WHERE id = ?",
    id
  );
}

async function setUp(foreignKeys: "on" | "off") {
  fixture = await createTestDatabase({ foreignKeys, migrations: "latest" });
  adminId = await createMember(adminEmail, "Api Admin", { password });
  await makeAdmin(adminId);
  ({ token } = await createAdminToken(adminId, "laptop"));
}

void describe("/api/admin/members", () => {
  beforeEach(async () => setUp("on"));
  afterEach(async () => fixture.cleanup());

  void describe("GET /members", () => {
    void test("lists members by name with their approved Submission counts", async () => {
      const jane = await createMember("jane@example.test", "Jane Breeder");
      await createMember("zed@example.test", "Zed Keeper");
      await createRawSubmissionFixture(fixture.db, {
        memberId: jane,
        submitted: true,
        approved: true,
        approvedBy: adminId,
      });
      await createRawSubmissionFixture(fixture.db, { memberId: jane, submitted: true });

      const res = await request(app()).get("/api/admin/members").set(auth()).expect(200);
      assert.equal(res.body.count, 3);
      assert.deepEqual(
        res.body.members.map((m: { display_name: string }) => m.display_name),
        ["Api Admin", "Jane Breeder", "Zed Keeper"]
      );
      assert.deepEqual(res.body.members[1], {
        id: jane,
        email: "jane@example.test",
        display_name: "Jane Breeder",
        is_admin: false,
        submission_count: 1,
        fish_level: null,
        plant_level: null,
        coral_level: null,
      });
    });

    void test("filters by search text, admin, submissions, limit and offset", async () => {
      const jane = await createMember("jane@example.test", "Jane Breeder");
      await createMember("zed@example.test", "Zed Keeper");
      await createRawSubmissionFixture(fixture.db, {
        memberId: jane,
        submitted: true,
        approved: true,
        approvedBy: adminId,
      });
      const names = async (query: string): Promise<string[]> => {
        const res = await request(app()).get(`/api/admin/members?${query}`).set(auth()).expect(200);
        const body = res.body as { members: { display_name: string }[] };
        return body.members.map((m) => m.display_name);
      };

      assert.deepEqual(await names("query=KEEP"), ["Zed Keeper"]);
      assert.deepEqual(await names("query=jane%40"), ["Jane Breeder"]);
      assert.deepEqual(await names("is_admin=true"), ["Api Admin"]);
      assert.deepEqual(await names("is_admin=false"), ["Jane Breeder", "Zed Keeper"]);
      assert.deepEqual(await names("has_submissions=true"), ["Jane Breeder"]);
      assert.deepEqual(await names("has_submissions=false"), ["Api Admin", "Zed Keeper"]);
      assert.deepEqual(await names("limit=1&offset=1"), ["Jane Breeder"]);
    });

    void test("rejects a bad filter with 400", async () => {
      for (const query of ["limit=0", "limit=abc", "offset=-1", "is_admin=yes", "colour=red"]) {
        const res = await request(app()).get(`/api/admin/members?${query}`).set(auth()).expect(400);
        assert.equal(res.body.error, "bad_request", query);
      }
    });
  });

  void describe("GET /members/:id", () => {
    void test("returns the member with logins, counts, points, awards and tank presets", async () => {
      const id = await createMember("jane@example.test", "Jane Breeder", {
        password,
        google_sub: "google-1",
        apple_sub: "apple-1",
      });
      await fixture.db.run(
        "UPDATE apple_account SET apple_email = 'relay@privaterelay.appleid.com' WHERE member_id = ?",
        id
      );
      await createRawSubmissionFixture(fixture.db, {
        memberId: id,
        submitted: true,
        approved: true,
        approvedBy: adminId,
        points: 15,
      });
      await createRawSubmissionFixture(fixture.db, { memberId: id, submitted: true });
      await fixture.db.run(
        "INSERT INTO awards (member_id, award_name, date_awarded) VALUES (?, 'Breeder', '2026-01-01')",
        id
      );

      const res = await request(app()).get(`/api/admin/members/${id}`).set(auth()).expect(200);
      assert.deepEqual(res.body.member, {
        id,
        email: "jane@example.test",
        display_name: "Jane Breeder",
        is_admin: false,
        fish_level: null,
        plant_level: null,
        coral_level: null,
        logins: {
          password: true,
          google: { email: "jane@example.test" },
          apple: { email: "relay@privaterelay.appleid.com" },
        },
        submission_count: 2,
        approved_submission_count: 1,
        total_points: 15,
        awards: ["Breeder"],
        tank_presets: [],
      });
    });

    void test("a member with no logins says so", async () => {
      const id = await createMember("bare@example.test", "Bare");
      const res = await request(app()).get(`/api/admin/members/${id}`).set(auth()).expect(200);
      assert.deepEqual(res.body.member.logins, { password: false, google: null, apple: null });
    });

    void test("an unknown member is 404 and a non-numeric id is 400", async () => {
      assert.equal(
        (await request(app()).get("/api/admin/members/99999").set(auth()).expect(404)).body.error,
        "not_found"
      );
      await request(app()).get("/api/admin/members/abc").set(auth()).expect(400);
      await request(app()).get("/api/admin/members/0").set(auth()).expect(400);
    });
  });

  void describe("PATCH /members/:id", () => {
    void test("changes the name and address, trimmed, and returns the member", async () => {
      const id = await createMember("jane@example.test", "Jane");
      const res = await request(app())
        .patch(`/api/admin/members/${id}`)
        .set(auth())
        .send({ display_name: "  Jane Breeder ", contact_email: " Jane.B@example.test " })
        .expect(200);
      assert.equal(res.body.member.display_name, "Jane Breeder");
      assert.equal(res.body.member.email, "Jane.B@example.test");

      const only = await request(app())
        .patch(`/api/admin/members/${id}`)
        .set(auth())
        .send({ display_name: "J. Breeder" })
        .expect(200);
      assert.equal(only.body.member.email, "Jane.B@example.test");
    });

    void test("rejects an empty body, a bad address, a blank name and other fields with 400", async () => {
      const id = await createMember("jane@example.test", "Jane");
      for (const body of [
        {},
        { contact_email: "not-an-address" },
        { display_name: "   " },
        { is_admin: true },
        { display_name: "Ok", fish_level: "Breeder" },
      ]) {
        const res = await request(app())
          .patch(`/api/admin/members/${id}`)
          .set(auth())
          .send(body)
          .expect(400);
        assert.equal(res.body.error, "bad_request", JSON.stringify(body));
      }
      const row = await fixture.db.get<{ display_name: string }>(
        "SELECT display_name FROM members WHERE id = ?",
        id
      );
      assert.equal(row?.display_name, "Jane");
    });

    void test("an address another member holds, in any case, is 409", async () => {
      const id = await createMember("jane@example.test", "Jane");
      const res = await request(app())
        .patch(`/api/admin/members/${id}`)
        .set(auth())
        .send({ contact_email: "API-ADMIN@example.test" })
        .expect(409);
      assert.equal(res.body.error, "conflict");
      // Re-casing a member's own address is not a conflict.
      await request(app())
        .patch(`/api/admin/members/${id}`)
        .set(auth())
        .send({ contact_email: "JANE@example.test" })
        .expect(200);
    });

    void test("an unknown member is 404", async () => {
      await request(app())
        .patch("/api/admin/members/99999")
        .set(auth())
        .send({ display_name: "Ghost" })
        .expect(404);
    });
  });

  void describe("PUT /members/:id/admin", () => {
    void test("grants and revokes admin", async () => {
      const id = await createMember("jane@example.test", "Jane");
      const granted = await request(app())
        .put(`/api/admin/members/${id}/admin`)
        .set(auth())
        .send({ is_admin: true })
        .expect(200);
      assert.deepEqual(granted.body.member, { id, display_name: "Jane", is_admin: true });
      await request(app())
        .put(`/api/admin/members/${id}/admin`)
        .set(auth())
        .send({ is_admin: false })
        .expect(200);
      const row = await fixture.db.get<{ is_admin: number }>(
        "SELECT is_admin FROM members WHERE id = ?",
        id
      );
      assert.equal(row?.is_admin, 0);
    });

    void test("an admin cannot revoke their own admin with their token: 409", async () => {
      const res = await request(app())
        .put(`/api/admin/members/${adminId}/admin`)
        .set(auth())
        .send({ is_admin: false })
        .expect(409);
      assert.equal(res.body.error, "conflict");
      const row = await fixture.db.get<{ is_admin: number }>(
        "SELECT is_admin FROM members WHERE id = ?",
        adminId
      );
      assert.equal(row?.is_admin, 1);
      // Re-granting themselves is harmless.
      await request(app())
        .put(`/api/admin/members/${adminId}/admin`)
        .set(auth())
        .send({ is_admin: true })
        .expect(200);
    });

    void test("a member demoted through the API has their token refused with 403", async () => {
      const otherId = await createMember("other-admin@example.test", "Other Admin");
      await makeAdmin(otherId);
      const other = await createAdminToken(otherId, "their laptop");
      await request(app()).get("/api/admin/whoami").set(auth(other.token)).expect(200);

      await request(app())
        .put(`/api/admin/members/${otherId}/admin`)
        .set(auth())
        .send({ is_admin: false })
        .expect(200);
      const res = await request(app()).get("/api/admin/members").set(auth(other.token)).expect(403);
      assert.equal(res.body.error, "forbidden");
    });

    void test("a missing or non-boolean is_admin is 400 and an unknown member 404", async () => {
      const id = await createMember("jane@example.test", "Jane");
      for (const body of [{}, { is_admin: "true" }, { is_admin: 1 }]) {
        await request(app())
          .put(`/api/admin/members/${id}/admin`)
          .set(auth())
          .send(body)
          .expect(400);
      }
      await request(app())
        .put("/api/admin/members/99999/admin")
        .set(auth())
        .send({ is_admin: true })
        .expect(404);
    });
  });

  void describe("DELETE /members/:id", () => {
    void test("deletes a member without approved Submissions and revokes their tokens", async () => {
      const otherId = await createMember("other-admin@example.test", "Other Admin");
      await makeAdmin(otherId);
      const other = await createAdminToken(otherId, "their laptop");
      await createRawSubmissionFixture(fixture.db, { memberId: otherId, submitted: true });

      const res = await request(app())
        .delete(`/api/admin/members/${otherId}`)
        .set(auth())
        .expect(200);
      assert.deepEqual(res.body.deleted, {
        id: otherId,
        display_name: "Other Admin",
        submission_count: 1,
        approved_submission_count: 0,
        admin_tokens_revoked: 1,
      });
      await request(app()).get(`/api/admin/members/${otherId}`).set(auth()).expect(404);
      await request(app()).get("/api/admin/whoami").set(auth(other.token)).expect(401);
    });

    void test("refuses a member with approved Submissions unless forced", async () => {
      const id = await createMember("jane@example.test", "Jane");
      await createRawSubmissionFixture(fixture.db, {
        memberId: id,
        submitted: true,
        approved: true,
        approvedBy: adminId,
      });
      const refused = await request(app())
        .delete(`/api/admin/members/${id}`)
        .set(auth())
        .expect(409);
      assert.match(refused.body.message, /1 approved submissions/);
      await request(app()).get(`/api/admin/members/${id}`).set(auth()).expect(200);

      const forced = await request(app())
        .delete(`/api/admin/members/${id}?force=true`)
        .set(auth())
        .expect(200);
      assert.equal(forced.body.deleted.approved_submission_count, 1);
      await request(app()).get(`/api/admin/members/${id}`).set(auth()).expect(404);
    });

    void test("an admin cannot delete the member their token acts as: 409", async () => {
      await request(app())
        .delete(`/api/admin/members/${adminId}?force=true`)
        .set(auth())
        .expect(409);
      await request(app()).get("/api/admin/whoami").set(auth()).expect(200);
    });

    void test("an unknown member is 404 and a bad force is 400", async () => {
      await request(app()).delete("/api/admin/members/99999").set(auth()).expect(404);
      const id = await createMember("jane@example.test", "Jane");
      await request(app()).delete(`/api/admin/members/${id}?force=1`).set(auth()).expect(400);
    });
  });

  void describe("POST /members/:id/merge", () => {
    void test("preview reports what would move and changes nothing", async () => {
      const dupe = await createMember("dupe@example.test", "Jane Dupe");
      const keeper = await createMember("jane@example.test", "Jane");
      await createRawSubmissionFixture(fixture.db, { memberId: dupe, submitted: true });
      const res = await request(app())
        .post(`/api/admin/members/${dupe}/merge`)
        .set(auth())
        .send({ into_member_id: keeper, preview: true })
        .expect(200);
      assert.equal(res.body.preview, true);
      assert.equal(res.body.preview_data.from_member.submission_count, 1);
      await request(app()).get(`/api/admin/members/${dupe}`).set(auth()).expect(200);
    });

    void test("merges :id into into_member_id and revokes the absorbed member's tokens", async () => {
      const dupe = await createMember("dupe@example.test", "Jane Dupe", { apple_sub: "apple-1" });
      await makeAdmin(dupe);
      const dupeToken = await createAdminToken(dupe, "dupe laptop");
      const keeper = await createMember("jane@example.test", "Jane", { password });
      await createRawSubmissionFixture(fixture.db, { memberId: dupe, submitted: true });

      const res = await request(app())
        .post(`/api/admin/members/${dupe}/merge`)
        .set(auth())
        .send({ into_member_id: keeper })
        .expect(200);
      assert.equal(res.body.from_member_id, dupe);
      assert.equal(res.body.to_member_id, keeper);
      assert.equal(res.body.submissions_moved, 1);
      assert.equal(res.body.admin_tokens_revoked, 1);
      assert.deepEqual(res.body.logins_moved, { google: 0, apple: 1, password: 0 });

      await request(app()).get(`/api/admin/members/${dupe}`).set(auth()).expect(404);
      const kept = await request(app()).get(`/api/admin/members/${keeper}`).set(auth()).expect(200);
      assert.equal(kept.body.member.submission_count, 1);
      assert.equal(kept.body.member.is_admin, false);
      await request(app()).get("/api/admin/whoami").set(auth(dupeToken.token)).expect(401);
    });

    void test("an admin may merge another member into themselves", async () => {
      const dupe = await createMember("dupe@example.test", "Admin Dupe");
      await request(app())
        .post(`/api/admin/members/${dupe}/merge`)
        .set(auth())
        .send({ into_member_id: adminId })
        .expect(200);
      await request(app()).get("/api/admin/whoami").set(auth()).expect(200);
    });

    void test("an admin cannot merge away the member their token acts as: 409", async () => {
      const keeper = await createMember("jane@example.test", "Jane");
      const res = await request(app())
        .post(`/api/admin/members/${adminId}/merge`)
        .set(auth())
        .send({ into_member_id: keeper })
        .expect(409);
      assert.equal(res.body.error, "conflict");
      await request(app()).get("/api/admin/whoami").set(auth()).expect(200);
    });

    void test("into itself or a bad body is 400; an unknown member on either side is 404", async () => {
      const id = await createMember("jane@example.test", "Jane");
      for (const body of [
        {},
        { into_member_id: id },
        { into_member_id: "2" },
        { to_member_id: 1 },
      ]) {
        await request(app())
          .post(`/api/admin/members/${id}/merge`)
          .set(auth())
          .send(body)
          .expect(400);
      }
      await request(app())
        .post(`/api/admin/members/${id}/merge`)
        .set(auth())
        .send({ into_member_id: 99999 })
        .expect(404);
      await request(app())
        .post("/api/admin/members/99999/merge")
        .set(auth())
        .send({ into_member_id: id })
        .expect(404);
    });
  });

  void test("an admin's session alone, without a token, is 401 on every member endpoint", async () => {
    const id = await createMember("jane@example.test", "Jane");
    const agent = request.agent(app());
    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email: adminEmail, password })
      .expect(200);
    await agent.get("/admin/members").expect(200);
    await agent.get("/api/admin/members").expect(401);
    await agent.get(`/api/admin/members/${id}`).expect(401);
    await agent.patch(`/api/admin/members/${id}`).send({ display_name: "X" }).expect(401);
    await agent.put(`/api/admin/members/${id}/admin`).send({ is_admin: true }).expect(401);
    await agent.delete(`/api/admin/members/${id}`).expect(401);
    await agent
      .post(`/api/admin/members/${id}/merge`)
      .send({ into_member_id: adminId })
      .expect(401);
    const row = await fixture.db.get<{ display_name: string; is_admin: number }>(
      "SELECT display_name, is_admin FROM members WHERE id = ?",
      id
    );
    assert.deepEqual(row, { display_name: "Jane", is_admin: 0 });
  });
});

// Production runs with foreign keys unenforced, so ON DELETE CASCADE never
// removes a deleted member's tokens: they must be revoked explicitly.
void describe("/api/admin/members with foreign keys off, as in production", () => {
  beforeEach(async () => setUp("off"));
  afterEach(async () => fixture.cleanup());

  void test("deleting a member revokes their tokens rather than relying on the cascade", async () => {
    const otherId = await createMember("other-admin@example.test", "Other Admin");
    await makeAdmin(otherId);
    const other = await createAdminToken(otherId, "their laptop");
    await request(app()).delete(`/api/admin/members/${otherId}`).set(auth()).expect(200);
    assert.ok((await tokenState(other.record.id))?.revoked_at);
    await request(app()).get("/api/admin/whoami").set(auth(other.token)).expect(401);
  });

  void test("merging a member away revokes their tokens", async () => {
    const dupe = await createMember("dupe@example.test", "Dupe Admin");
    await makeAdmin(dupe);
    const dupeToken = await createAdminToken(dupe, "dupe laptop");
    const keeper = await createMember("jane@example.test", "Jane");
    await request(app())
      .post(`/api/admin/members/${dupe}/merge`)
      .set(auth())
      .send({ into_member_id: keeper })
      .expect(200);
    assert.ok((await tokenState(dupeToken.record.id))?.revoked_at);
    await request(app()).get("/api/admin/whoami").set(auth(dupeToken.token)).expect(401);
  });
});

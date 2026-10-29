import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import { createAdminToken } from "../db/adminTokens";
import { createMember } from "../db/members";
import { resetNotifier } from "../lifecycle";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { ensureGuppySpecies } from "./helpers/fixtures";
import {
  readSubmission,
  recordNotifications,
  submissionInState,
  type RecordingNotifier,
} from "./helpers/lifecycleFixtures";

const password = "Good test password 42!";

let fixture: TestDatabase;
let adminId: number;
let memberId: number;
let token: string;
let guppy: number;
let sent: RecordingNotifier;

const app = () => createApp({ env: { NODE_ENV: "test" } });
const auth = () => ({ Authorization: `Bearer ${token}` });
const api = {
  get: (path: string) => request(app()).get(`/api/admin/submissions${path}`).set(auth()),
  post: (path: string, body: object = {}) =>
    request(app()).post(`/api/admin/submissions${path}`).set(auth()).send(body),
};

/** An approved Submission bound to no Species, as the five on prod are. */
const approvedUnbound = () =>
  submissionInState(fixture.db, "approved", {
    memberId,
    witnessedBy: adminId,
    speciesId: null,
    points: 10,
    caresSpecies: true,
  });

const changelog = async (submissionId: number) =>
  fixture.db.all<{ admin_id: number; note_text: string }[]>(
    "SELECT admin_id, note_text FROM submission_notes WHERE submission_id = ?",
    submissionId
  );

beforeEach(async () => {
  fixture = await createTestDatabase({ foreignKeys: "off", migrations: "latest" });
  adminId = await createMember("subs-api-admin@example.test", "Subs Admin", { password });
  await fixture.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", adminId);
  memberId = await createMember("breeder@example.test", "Bea Breeder");
  ({ token } = await createAdminToken(adminId, "test"));
  guppy = await ensureGuppySpecies(fixture.db);
  sent = recordNotifications();
});
afterEach(async () => {
  resetNotifier();
  await fixture.cleanup();
});

void describe("GET /api/admin/submissions", () => {
  void test("unbound and approved finds approved unbound rows, not bound or pending ones", async () => {
    const unbound = await approvedUnbound();
    await submissionInState(fixture.db, "approved", { memberId, witnessedBy: adminId, points: 10 });
    await submissionInState(fixture.db, "pendingWitness", { memberId, speciesId: null });

    const res = await api.get("?unbound=true&state=approved").expect(200);
    assert.equal(res.body.total_count, 1);
    const [row] = res.body.submissions;
    assert.equal(row.id, unbound);
    assert.equal(row.member_id, memberId);
    assert.equal(row.member_name, "Bea Breeder");
    assert.equal(row.species_id, null);
    assert.equal(row.state, "approved");
    assert.equal(row.points, 10);
    assert.ok(row.approved_on);
  });

  void test("filters by member, state, limit and offset", async () => {
    const other = await createMember("other@example.test", "Other Breeder");
    await submissionInState(fixture.db, "approved", { memberId: other, witnessedBy: adminId, points: 5 });
    const waiting = await submissionInState(fixture.db, "waitingPeriod", { memberId, witnessedBy: adminId, points: 5 });
    await submissionInState(fixture.db, "inApprovalQueue", { memberId, witnessedBy: adminId, points: 5 });

    const mine = await api.get(`?member_id=${memberId}`).expect(200);
    assert.equal(mine.body.total_count, 2);
    const inWaiting = await api.get("?state=waitingPeriod").expect(200);
    assert.deepEqual(
      inWaiting.body.submissions.map((s: { id: number }) => s.id),
      [waiting]
    );
    const page = await api.get("?limit=1&offset=1").expect(200);
    assert.equal(page.body.total_count, 3);
    assert.equal(page.body.submissions.length, 1);
  });

  void test("rejects a bad filter with 400", async () => {
    for (const q of ["unbound=yes", "state=denied", "limit=0", "member_id=x", "colour=red"]) {
      const res = await api.get(`?${q}`).expect(400);
      assert.equal(res.body.error, "bad_request", q);
    }
  });
});

void describe("GET /api/admin/submissions/:id", () => {
  void test("returns the Submission with its bound Species' Canonical name", async () => {
    const id = await submissionInState(fixture.db, "approved", { memberId, witnessedBy: adminId, points: 10 });
    const res = await api.get(`/${id}`).expect(200);
    assert.equal(res.body.submission.id, id);
    assert.equal(res.body.submission.species_id, guppy);
    assert.equal(res.body.submission.species_canonical_name, "Poecilia reticulata");
    assert.equal(res.body.submission.cares_species, false);
  });

  void test("404 for an unknown Submission", async () => {
    const res = await api.get("/99999").expect(404);
    assert.equal(res.body.error, "not_found");
  });
});

void describe("POST /api/admin/submissions/:id/correction", () => {
  void test("binds an approved unbound Submission, keeps its points, logs once, tells nobody", async () => {
    const id = await approvedUnbound();
    const before = (await readSubmission(id))!;

    const res = await api
      .post(`/${id}/correction`, { group_id: guppy, reason: "Bind to the catalogue" })
      .expect(200);

    assert.equal(res.body.preview, false);
    assert.equal(res.body.submission_id, id);
    assert.equal(res.body.notified, false);
    assert.deepEqual(res.body.changes, [
      { field: "species", old: null, new: "Poecilia reticulata" },
    ]);
    assert.equal(res.body.submission.species_canonical_name, "Poecilia reticulata");

    const after = (await readSubmission(id))!;
    assert.equal(after.species_id, guppy);
    assert.equal(after.points, before.points);
    assert.equal(Boolean(after.cares_species), true);
    assert.equal(after.approved_on, before.approved_on);
    assert.equal(after.first_time_species, before.first_time_species);

    const notes = await changelog(id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].admin_id, adminId);
    const note = JSON.parse(notes[0].note_text) as { type: string; reason: string };
    assert.equal(note.type, "admin_edit");
    assert.equal(note.reason, "Bind to the catalogue");

    assert.deepEqual(sent.kinds, [], "no letter without notify");
    const feed = await fixture.db.all<{ activity_type: string }[]>(
      "SELECT activity_type FROM activity_feed WHERE related_id = ?",
      String(id)
    );
    assert.deepEqual(
      feed.map((f) => f.activity_type),
      ["submission_approved"],
      "the approval's feed entry is refreshed in place"
    );
  });

  void test("changes only the points fields sent", async () => {
    const id = await approvedUnbound();
    const res = await api
      .post(`/${id}/correction`, { group_id: guppy, reason: "Bind and revalue", points: 15 })
      .expect(200);
    assert.deepEqual(
      res.body.changes.map((c: { field: string }) => c.field),
      ["species", "points"]
    );
    const after = (await readSubmission(id))!;
    assert.equal(after.points, 15);
    assert.equal(Boolean(after.cares_species), true);
  });

  void test("notify: true sends the approval letter", async () => {
    const id = await approvedUnbound();
    await api
      .post(`/${id}/correction`, { group_id: guppy, reason: "Bind", notify: true })
      .expect(200)
      .expect((res) => assert.equal(res.body.notified, true));
    assert.deepEqual(sent.of("approved"), [
      { kind: "approved", to: ["breeder@example.test"], about: id },
    ]);
  });

  void test("preview reports the changes and writes nothing", async () => {
    const id = await approvedUnbound();
    const before = (await readSubmission(id))!;

    const res = await api
      .post(`/${id}/correction`, { group_id: guppy, reason: "Bind", points: 20, preview: true, notify: true })
      .expect(200);
    assert.equal(res.body.preview, true);
    assert.equal(res.body.notified, false);
    assert.deepEqual(
      res.body.changes.map((c: { field: string }) => c.field),
      ["species", "points"]
    );
    assert.equal(res.body.submission.species_id, guppy);
    assert.equal(res.body.submission.points, 20);

    assert.deepEqual(await readSubmission(id), before);
    assert.equal((await changelog(id)).length, 0);
    assert.deepEqual(sent.kinds, []);
  });

  void test("refuses a missing reason, a bad group_id and an unknown Submission", async () => {
    const id = await approvedUnbound();

    const noReason = await api.post(`/${id}/correction`, { group_id: guppy }).expect(400);
    assert.match(noReason.body.message, /reason/);
    await api.post(`/${id}/correction`, { group_id: guppy, reason: "   " }).expect(400);

    const badSpecies = await api
      .post(`/${id}/correction`, { group_id: 99999, reason: "Bind" })
      .expect(400);
    assert.match(badSpecies.body.message, /Species that exists/);
    await api.post(`/${id}/correction`, { group_id: "guppy", reason: "Bind" }).expect(400);
    await api.post(`/${id}/correction`, { group_id: true, reason: "Bind" }).expect(400);
    await api.post(`/${id}/correction`, { group_id: String(guppy), reason: "Bind" }).expect(400);

    const unknown = await api.post("/99999/correction", { group_id: guppy, reason: "Bind" }).expect(404);
    assert.equal(unknown.body.error, "not_found");

    assert.equal((await readSubmission(id))!.species_id, null);
  });

  void test("409 for a move the lifecycle refuses", async () => {
    const pending = await submissionInState(fixture.db, "pendingWitness", { memberId, speciesId: null, points: 10 });
    const res = await api
      .post(`/${pending}/correction`, { group_id: guppy, reason: "Bind", points: 10 })
      .expect(409);
    assert.equal(res.body.error, "conflict");

    const own = await submissionInState(fixture.db, "approved", {
      memberId: adminId,
      witnessedBy: memberId,
      speciesId: null,
      points: 10,
    });
    await api.post(`/${own}/correction`, { group_id: guppy, reason: "Bind" }).expect(409);
  });

  void test("a demoted admin's token is 403", async () => {
    const id = await approvedUnbound();
    await fixture.db.run("UPDATE members SET is_admin = 0 WHERE id = ?", adminId);
    const res = await api.post(`/${id}/correction`, { group_id: guppy, reason: "Bind" }).expect(403);
    assert.equal(res.body.error, "forbidden");
    assert.equal((await readSubmission(id))!.species_id, null);
  });
});

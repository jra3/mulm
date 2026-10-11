import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import path from "path";
import express from "express";
import request from "supertest";
import type { MulmRequest } from "@/sessions";
import * as species from "@/routes/species";
import * as admin from "@/routes/admin";
import * as member from "@/routes/member";
import * as submission from "@/routes/submission";
import { createMember } from "@/db/members";
import { resolveSpecies } from "@/species";
import { confirmWitness, resetNotifier } from "@/lifecycle";
import { bonusFields } from "@/points";
import { setupTestDatabase, type TestDatabase } from "./testDbHelper.helper";
import { createTestSubmission as createUnboundSubmission, ensureGuppySpecies } from "./helpers/testHelpers";
import { recordNotifications, submissionInState, witnessPoints } from "./helpers/lifecycleFixtures";

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

/**
 * The witness panel's Record new species step (#522), through the real
 * routes: the step is prefilled from the member's spelling, a refused step
 * comes back with its errors beside the fields, and an accepted one answers
 * with the whole panel, the new Species settled and the Points card prefilled
 * from it, while the catalogue still holds nothing.
 */
void describe("Record new species step", () => {
  let testDb: TestDatabase;
  let witness: MulmRequest["viewer"];
  let submissionId: number;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    const memberId = await createMember("breeder@example.com", "Dan Wu");
    const witnessId = await createMember("witness@example.com", "Jane Ortiz");
    witness = { id: witnessId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    submissionId = await createUnboundSubmission(testDb.db, {
      memberId,
      submitted: true,
      witnessStatus: "pending",
      speciesId: null,
      speciesClass: "Cichlids - New World",
      commonName: "Apisto Rio Mamuru",
      latinName: "Apistogramma sp. Rio Mamuru",
    });
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  const app = () =>
    appWith((a) => {
      a.use(express.urlencoded({ extended: true }));
      a.get("/admin/submissions/:id/record-species", admin.recordSpeciesFormAction);
      a.post("/admin/submissions/:id/record-species", admin.recordSpeciesAction);
      a.post("/admin/submissions/:id/witness-summary", admin.witnessSummaryAction);
    }, witness);

  void test("the step is prefilled from the member's spelling, with the Submission's type and class", async () => {
    const res = await request(app()).get(`/admin/submissions/${submissionId}/record-species`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="witness-record"/);
    assert.match(res.text, /name="new_scientific_name"[^>]*value="Apistogramma sp\. Rio Mamuru"/);
    assert.match(res.text, /name="new_common_name"[^>]*value="Apisto Rio Mamuru"/);
    assert.match(res.text, /Fish · Cichlids - New World/);
    assert.match(res.text, /name="new_cares_species"/, "a BAP Species may be CARES");
    assert.doesNotMatch(res.text, /checked="checked"/, "no Point class chosen yet");
  });

  void test("a refused step comes back with the values typed and the refusals beside their fields", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${submissionId}/record-species`)
      .type("form")
      .send({ new_scientific_name: "Apistogramma", new_common_name: "Apisto", new_point_class: "15", new_cares_species: "on" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-retarget"], undefined, "back into the Species card, where it was tried");
    assert.match(res.text, /id="witness-record"/);
    assert.match(res.text, /id="new_scientific_name-error"[^>]*>Give the scientific name as genus and species/);
    assert.match(res.text, /name="new_scientific_name"[^>]*value="Apistogramma"/);
    assert.match(res.text, /id="witness-new-point-class-15" checked="checked"/);
    assert.match(res.text, /name="new_cares_species"[^>]*checked="checked"/);
    assert.deepStrictEqual(await resolveSpecies({ latinName: "Apistogramma" }), null);
  });

  void test("an accepted step answers with the whole panel, the new Species settled and nothing created", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${submissionId}/record-species`)
      .type("form")
      .send({
        new_scientific_name: "Apistogramma sp. 'Rio Mamuru'",
        new_common_name: "Apisto Rio Mamuru",
        new_point_class: "15",
        new_cares_species: "on",
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-retarget"], "#witnessPanel");
    assert.strictEqual(res.headers["hx-reswap"], "outerHTML");
    assert.match(res.text, /id="witnessPanel"/);
    assert.match(res.text, /id="witness-recording"/);
    assert.match(res.text, /Dan Wu/);
    assert.match(res.text, /<input type="hidden" name="new_scientific_name" value="Apistogramma sp\. (&#39;|')Rio Mamuru(&#39;|')"\/>/);
    assert.match(res.text, /<input type="hidden" name="new_point_class" value="15"\/>/);
    assert.match(res.text, /<input type="hidden" name="new_cares_species" value="on"\/>/);
    assert.match(res.text, /name="points" value="15" id="witness-points-15" checked="checked"/);
    assert.match(res.text, /id="witness-confirm"[^>]*>Confirm witness · 20 pts</, "base 15 and CARES 5, prefilled");
    assert.strictEqual(await resolveSpecies({ latinName: "Apistogramma sp. 'Rio Mamuru'" }), null, "created only by the confirm");

    // The sticky bar, re-summed as the panel stands, counts the recorded Species as chosen
    const bar = await request(app())
      .post(`/admin/submissions/${submissionId}/witness-summary`)
      .type("form")
      .send({ new_scientific_name: "Apistogramma sp. 'Rio Mamuru'", species_settled: "1", points: "15", cares_species: "on" });
    assert.match(bar.text, /id="witness-sum-total">20 pts</);
  });
});

/**
 * Points a witness set but the committee has not awarded (#523): the owner
 * sees them, itemised and "pending approval", on their Submission page and
 * their submissions list; nobody else does, and the list's footer still sums
 * awarded points alone. Rendered through the real routes, so the locals the
 * views read are the ones the handlers pass.
 */
void describe("Pending points are the owner's alone", () => {
  let testDb: TestDatabase;
  let ownerId: number;
  let owner: MulmRequest["viewer"];
  let committee: MulmRequest["viewer"];
  let bystander: MulmRequest["viewer"];
  let pendingId: number;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    recordNotifications();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    const committeeId = await createMember("witness@example.com", "Jane Ortiz");
    const bystanderId = await createMember("other@example.com", "Sam Lee");
    owner = { id: ownerId, display_name: "Dan Wu", contact_email: "breeder@example.com", is_admin: false };
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    bystander = { id: bystanderId, display_name: "Sam Lee", contact_email: "other@example.com", is_admin: false };

    // One witnessed Submission with points pending, one approved for 15
    pendingId = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
    await confirmWitness(
      { id: committeeId, isAdmin: true },
      pendingId,
      witnessPoints({ points: 10, article_points: 5, cares_species: true })
    );
    await submissionInState(testDb.db, "approved", {
      memberId: ownerId,
      witnessedBy: committeeId,
      points: 15,
      speciesId: await ensureGuppySpecies(testDb.db),
    });
  });
  afterEach(async () => {
    resetNotifier();
    await testDb.cleanup();
  });

  const app = (viewer: MulmRequest["viewer"]) =>
    appWith((a) => {
      // The approval panel's error mixin reads this local, which src/index.ts sets app-wide
      a.use((_req, res, next) => {
        res.locals.bonusFields = bonusFields;
        next();
      });
      a.get("/submissions/:id", submission.view);
      a.get("/member/:memberId", member.view);
    }, viewer);

  void test("the owner's Submission page itemises the pending points, with no awarded-points fields", async () => {
    const res = await request(app(owner)).get(`/submissions/${pendingId}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="pending-points"/);
    assert.match(res.text, /Base points<\/td><td[^>]*>10</);
    assert.match(res.text, /Article Bonus<\/td><td[^>]*>\+5</);
    assert.match(res.text, /CARES Species Bonus<\/td><td[^>]*>\+5</);
    assert.match(res.text, /id="pending-points-total">20 pts</);
    assert.match(res.text, /Set at the Witness \(Jane Ortiz - /);
    assert.doesNotMatch(res.text, /name="total_points"|name="points"/);
  });

  void test("a committee member's view of the same page carries no pending block and no awarded points", async () => {
    const res = await request(app(committee)).get(`/submissions/${pendingId}`);

    assert.strictEqual(res.status, 200);
    assert.doesNotMatch(res.text, /pending-points|pending approval/);
    // The approval panel has its own points select; the awarded Total Points field is what waits
    assert.doesNotMatch(res.text, /name="total_points"/);
  });

  void test("to anyone else an unapproved Submission does not exist", async () => {
    assert.strictEqual((await request(app(bystander)).get(`/submissions/${pendingId}`)).status, 404);
    assert.strictEqual((await request(app(undefined)).get(`/submissions/${pendingId}`)).status, 404);
  });

  void test("the owner's submissions list shows the pending row's total and lines; the footer sums awarded points only", async () => {
    const res = await request(app(owner)).get(`/member/${ownerId}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /class="pending-points-total">20 pts</);
    assert.match(res.text, /pending approval/);
    assert.match(res.text, /Base points 10 \+ Article Bonus 5 \+ CARES Species Bonus 5/);
    assert.match(res.text, /Total:[\s\S]*?<td[^>]*>15<\/td>/, "the footer is the awarded 15, not 35");
    assert.doesNotMatch(res.text, /<td[^>]*>35<\/td>/);
  });

  void test("a committee member's view of the list says Unapproved for the pending row, and the footer is unchanged", async () => {
    const res = await request(app(committee)).get(`/member/${ownerId}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /Unapproved/);
    assert.doesNotMatch(res.text, /pending approval|pending-points-total/);
    assert.match(res.text, /Total:[\s\S]*?<td[^>]*>15<\/td>/);
  });

  void test("the public list carries only the approved row", async () => {
    const res = await request(app(undefined)).get(`/member/${ownerId}`);

    assert.strictEqual(res.status, 200);
    assert.doesNotMatch(res.text, /pending approval|Unapproved/);
    assert.match(res.text, /data-sort="15">15</);
  });
});

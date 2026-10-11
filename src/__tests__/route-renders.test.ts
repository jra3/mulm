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
import { getSubmissionById } from "@/db/submissions";
import { createSpecies, resolveSpecies } from "@/species";
import { confirmWitness, resetNotifier, WITNESS_RESET_NOTE } from "@/lifecycle";
import { addNote } from "@/db/submission_notes";
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
/**
 * A Submission migration 066 sent back for a Witness (#524) tells the
 * re-witnesser who saw the fry, read off the note the migration left.
 */
void describe("A reset Submission names its original witness on the panel", () => {
  let testDb: TestDatabase;
  let committee: MulmRequest["viewer"];
  let committeeId: number;
  let ownerId: number;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  const app = () =>
    appWith((a) => {
      a.use((_req, res, next) => {
        res.locals.bonusFields = bonusFields;
        next();
      });
      a.get("/submissions/:id", submission.view);
    }, committee);

  void test("the header says who witnessed it before and when", async () => {
    const id = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
    await addNote(id, committeeId, WITNESS_RESET_NOTE("Pat", "2026-01-02"));

    const res = await request(app()).get(`/submissions/${id}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="witness-original-witness"/);
    assert.match(res.text, /Originally witnessed by Pat on 01\/02\/2026\./);
  });

  void test("a Submission never reset says nothing about it", async () => {
    const id = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
    await addNote(id, committeeId, "Asked for a clearer photo of the fry");

    const res = await request(app()).get(`/submissions/${id}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="witnessPanel"/);
    assert.doesNotMatch(res.text, /witness-original-witness/);
  });
});

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

/**
 * The approval queue through the real routes (#527): the page lists what is
 * ready with the total the button will post, and the button's refusals come
 * back as the sheet, swapped over the page's placeholder, while a good
 * approval redirects back to the queue.
 */
void describe("Approval queue and the one button", () => {
  let testDb: TestDatabase;
  let committee: MulmRequest["viewer"];
  let committeeId: number;
  let ownerId: number;
  let readyId: number;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    recordNotifications();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    readyId = await submissionInState(testDb.db, "inApprovalQueue", {
      memberId: ownerId,
      witnessedBy: committeeId,
      points: 10,
      caresSpecies: true,
    });
  });
  afterEach(async () => {
    resetNotifier();
    await testDb.cleanup();
  });

  const app = (viewer: MulmRequest["viewer"] = committee) =>
    appWith((a) => {
      a.use(express.urlencoded({ extended: true }));
      a.get("/admin/queue{/:program}", admin.showQueue);
      a.post("/admin/submissions/:id/approve", admin.approveSubmission);
    }, viewer);

  void test("the page lists the ready row with the total it will post, first-time included", async () => {
    const waitingId = await submissionInState(testDb.db, "waitingPeriod", { memberId: ownerId, witnessedBy: committeeId });
    const res = await request(app()).get("/admin/queue");

    assert.strictEqual(res.status, 200);
    assert.match(res.text, new RegExp(`id="queue-row-${readyId}"`));
    assert.match(res.text, new RegExp(`id="queue-total-${readyId}">20<`), "base 10, CARES 5, first-time 5");
    assert.match(res.text, new RegExp(`id="queue-lines-${readyId}"[^>]*>Base points 10 \\+ First Time Species Bonus 5 \\+ CARES Species Bonus 5<`));
    assert.match(res.text, new RegExp(`<input type="hidden" name="expected_total" value="20">`));
    assert.match(res.text, new RegExp(`id="queue-approve-${readyId}">Approve · 15 pts \\+ 5 first-time<`));
    assert.match(res.text, new RegExp(`id="queue-waiting-${waitingId}"`));
    assert.doesNotMatch(res.text, new RegExp(`submissions/${waitingId}/approve`));
    assert.match(res.text, /All · 1<\/a>/);
  });

  void test("a Program page lists that Program alone; an unknown one is a 404", async () => {
    assert.match((await request(app()).get("/admin/queue/fish")).text, new RegExp(`id="queue-row-${readyId}"`));
    assert.doesNotMatch((await request(app()).get("/admin/queue/plant")).text, new RegExp(`id="queue-row-${readyId}"`));
    assert.strictEqual((await request(app()).get("/admin/queue/terrestrial")).status, 404);
  });

  void test("approving at the shown total awards it and sends the approver back to the queue they were on", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${readyId}/approve`)
      .set("HX-Current-URL", "http://localhost/admin/queue/fish")
      .type("form")
      .send({ expected_total: "20" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-redirect"], "/admin/queue/fish");
    const page = await request(app()).get("/admin/queue");
    assert.match(page.text, new RegExp(`id="queue-approved-${readyId}">[\\s\\S]*?Dan Wu · Guppy[\\s\\S]*?by Jane Ortiz[\\s\\S]*?20 pts<`));
    assert.doesNotMatch(page.text, new RegExp(`id="queue-row-${readyId}"`));
  });

  void test("a stale total comes back as the sheet with the fresh one, and nothing is approved", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${readyId}/approve`)
      .type("form")
      .send({ expected_total: "15" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-retarget"], "#approve-sheet");
    assert.strictEqual(res.headers["hx-reswap"], "outerHTML");
    assert.strictEqual(res.headers["hx-redirect"], undefined);
    assert.match(res.text, /id="approve-sheet-title">The points changed</);
    assert.match(res.text, /Dan Wu now gets <b>20 pts<\/b>, not 15\./);
    assert.match(res.text, /<input type="hidden" name="expected_total" value="20"\/>/);
    assert.match(res.text, /id="approve-sheet-approve"[^>]*>Approve · 20 pts</);
    assert.match(res.text, /id="approve-sheet-close" href="\/admin\/queue"/);
    assert.doesNotMatch(await request(app()).get("/admin/queue").then((r) => r.text), /queue-approved-/);
  });

  void test("the approver's own Submission is refused with the sheet, not approved", async () => {
    const own = await submissionInState(testDb.db, "inApprovalQueue", { memberId: committeeId, witnessedBy: ownerId });
    const page = await request(app()).get("/admin/queue");
    assert.match(page.text, new RegExp(`id="queue-own-${own}"`));

    const res = await request(app())
      .post(`/admin/submissions/${own}/approve`)
      .type("form")
      .send({ expected_total: "15" });

    assert.strictEqual(res.headers["hx-retarget"], "#approve-sheet");
    assert.match(res.text, /id="approve-sheet-title">Not approved</);
    assert.match(res.text, /your own submission/);
    assert.doesNotMatch(res.text, /expected_total/);
  });

  void test("a body without the total is refused with the sheet", async () => {
    const res = await request(app()).post(`/admin/submissions/${readyId}/approve`).type("form").send({});
    assert.strictEqual(res.headers["hx-retarget"], "#approve-sheet");
    assert.match(res.text, /Reload the queue/);
  });

  void test("the review page tells the committee what approval would award and points at the queue", async () => {
    const page = appWith((a) => {
      a.use((_req, res, next) => {
        res.locals.bonusFields = bonusFields;
        next();
      });
      a.get("/submissions/:id", submission.view);
    }, committee);
    const res = await request(page).get(`/submissions/${readyId}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="approval-preview">Base points 10 \+ First Time Species Bonus 5 \+ CARES Species Bonus 5 = <b>20 pts<\/b></);
    assert.match(res.text, new RegExp(`id="approval-queue-link" href="/admin/queue#queue-row-${readyId}"`));
    assert.doesNotMatch(res.text, /\/approve"|name="points"/);
  });
});

/**
 * The correction form (#528): reached as a page, asked for again with another
 * Species chosen, and saved with a reason. Rendered through the real handlers
 * so the locals the panel reads are the ones the routes pass.
 */
void describe("The committee corrects Species and points", () => {
  let testDb: TestDatabase;
  let committee: MulmRequest["viewer"];
  let committeeId: number;
  let ownerId: number;
  let witnessedId: number;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
    recordNotifications();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    witnessedId = await submissionInState(testDb.db, "waitingPeriod", {
      memberId: ownerId,
      witnessedBy: committeeId,
      points: 10,
      caresSpecies: true,
    });
  });
  afterEach(async () => {
    resetNotifier();
    await testDb.cleanup();
  });

  const app = (viewer: MulmRequest["viewer"] = committee) =>
    appWith((a) => {
      a.use(express.urlencoded({ extended: true }));
      a.use((_req, res, next) => {
        res.locals.bonusFields = bonusFields;
        next();
      });
      a.get("/submissions/:id", submission.view);
      a.get("/admin/submissions/:id/correct-points", admin.correctPointsFormAction);
      a.post("/admin/submissions/:id/correct-points", admin.correctPointsAction);
      a.get("/admin/submissions/:id/record-species", admin.recordSpeciesFormAction);
      a.post("/admin/submissions/:id/record-species", admin.recordSpeciesAction);
      a.post("/admin/submissions/:id/witness-summary", admin.witnessSummaryAction);
    }, viewer);

  void test("the page shows the current Species and points, prefilled, with Save correction", async () => {
    const res = await request(app()).get(`/admin/submissions/${witnessedId}/correct-points`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /<title>Correct species and points - BAS BAP<\/title>/);
    assert.match(res.text, /id="witnessPanel"/);
    assert.match(res.text, /Dan Wu/);
    assert.match(res.text, /Currently/);
    assert.match(res.text, /id="witness-bound-species"[^>]*>Poecilia reticulata</);
    // A page carries a doctype, so Pug writes boolean attributes bare
    assert.match(res.text, /name="points" value="10" id="witness-points-10" checked>/);
    assert.match(res.text, /name="cares_species" value="on" checked>/);
    assert.match(res.text, /id="correction-save" type="submit">Save correction · 15 pts</);
    assert.doesNotMatch(res.text, /name="first_time_species"/, "not approved: first-time is approval's");
    assert.match(res.text, new RegExp(`id="correction-cancel" href="/submissions/${witnessedId}"`));
  });

  void test("the Submission page links the committee to the form from the Witness on, and the approval queue row already does", async () => {
    const res = await request(app()).get(`/submissions/${witnessedId}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, new RegExp(`id="correct-points-link" href="/admin/submissions/${witnessedId}/correct-points"`));

    const approvedId = await submissionInState(testDb.db, "approved", { memberId: ownerId, witnessedBy: committeeId });
    const approved = await request(app()).get(`/submissions/${approvedId}`);
    assert.match(approved.text, new RegExp(`id="correct-points-link" href="/admin/submissions/${approvedId}/correct-points"`));
  });

  void test("asked for again with another Species, the panel alone comes back with that Species settled and its Point class as the base points", async () => {
    const other = await createSpecies({
      canonicalGenus: "Ameca",
      canonicalSpeciesName: "splendens",
      programClass: "Livebearers",
      speciesType: "Fish",
      pointClass: 15,
    });

    const res = await request(app())
      .get(`/admin/submissions/${witnessedId}/correct-points`)
      .query({ species_id: other })
      .set("HX-Request", "true");

    assert.strictEqual(res.status, 200);
    assert.doesNotMatch(res.text, /<title>/, "the panel, not the page");
    assert.match(res.text, /id="witnessPanel"/);
    assert.match(res.text, /You chose/);
    assert.match(res.text, /id="witness-bound-species"[^>]*>Ameca splendens</);
    assert.match(res.text, new RegExp(`<input type="hidden" name="species_id" value="${other}"/>`));
    assert.match(res.text, /name="points" value="15" id="witness-points-15" checked="checked"/);
    assert.match(res.text, /id="witness-point-class"[^>]*>From the Species' Point class \(15\)\.</);
    assert.doesNotMatch(res.text, /name="cares_species" value="on" checked/, "CARES follows the new Species");
    assert.match(res.text, /id="correction-save" type="submit">Save correction · 15 pts</);
    const row = await getSubmissionById(witnessedId);
    assert.strictEqual(row!.species_id, await ensureGuppySpecies(testDb.db), "nothing written: Save does");

    // The picker names it group_id; the same answer
    const picked = await request(app())
      .get(`/admin/submissions/${witnessedId}/correct-points`)
      .query({ group_id: other })
      .set("HX-Request", "true");
    assert.match(picked.text, /id="witness-bound-species"[^>]*>Ameca splendens</);

    const missing = await request(app())
      .get(`/admin/submissions/${witnessedId}/correct-points`)
      .query({ species_id: 987654 })
      .set("HX-Request", "true");
    assert.strictEqual(missing.headers["hx-retarget"], "#committee-error");
    assert.match(missing.text, /Choose a Species that exists/);
  });

  void test("saving writes the correction with its reason and returns to the Submission; the member is emailed the new breakdown", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${witnessedId}/correct-points`)
      .type("form")
      .send({
        correction: "1",
        species_id: String(await ensureGuppySpecies(testDb.db)),
        species_settled: "1",
        points: "15",
        article_points: "5",
        reason: "The member disputed the point class; it is a 15",
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-redirect"], `/submissions/${witnessedId}`);
    const row = (await getSubmissionById(witnessedId))!;
    assert.strictEqual(row.points, 15);
    assert.strictEqual(row.article_points, 5);
    assert.strictEqual(row.cares_species, 0, "the switch was off on the form");
    assert.strictEqual(row.witness_verification_status, "confirmed");
    assert.strictEqual(row.approved_on, null);
  });

  void test("a refusal lands in the panel's alert: no reason, first-time before approval, a bonus outside the Program", async () => {
    const guppy = String(await ensureGuppySpecies(testDb.db));
    const post = (body: Record<string, string>) =>
      request(app()).post(`/admin/submissions/${witnessedId}/correct-points`).type("form").send({ species_id: guppy, points: "15", ...body });

    const noReason = await post({});
    assert.strictEqual(noReason.headers["hx-retarget"], "#committee-error");
    assert.match(noReason.text, /Say why the points are being corrected/);

    const early = await post({ reason: "First of its kind", first_time_species: "on" });
    assert.match(early.text, /First-time is decided at approval/);

    const plant = await post({ reason: "A plant", flowered: "on" });
    assert.match(plant.text, /flowered/i);

    assert.strictEqual((await getSubmissionById(witnessedId))!.points, 10, "nothing written");
  });

  void test("on an Approved Submission the form offers first-time, and saving it is accepted", async () => {
    const approvedId = await submissionInState(testDb.db, "approved", { memberId: ownerId, witnessedBy: committeeId, points: 10 });

    const page = await request(app()).get(`/admin/submissions/${approvedId}/correct-points`);
    assert.match(page.text, /name="first_time_species" value="on"/);
    assert.match(page.text, /id="correction-standing"[^>]*>Approved: the points are awarded/);

    const res = await request(app())
      .post(`/admin/submissions/${approvedId}/correct-points`)
      .type("form")
      .send({
        species_id: String(await ensureGuppySpecies(testDb.db)),
        points: "10",
        first_time_species: "on",
        reason: "It was the first of its Species after all",
      });
    assert.strictEqual(res.headers["hx-redirect"], `/submissions/${approvedId}`);
    assert.strictEqual((await getSubmissionById(approvedId))!.first_time_species, 1);
  });

  void test("the committee's own Submission, and one still awaiting a Witness, get no form", async () => {
    const own = await submissionInState(testDb.db, "waitingPeriod", { memberId: committeeId, witnessedBy: ownerId });
    const ownRes = await request(app()).get(`/admin/submissions/${own}/correct-points`);
    assert.strictEqual(ownRes.status, 403);

    const pending = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
    const pendingRes = await request(app()).get(`/admin/submissions/${pending}/correct-points`);
    assert.strictEqual(pendingRes.status, 403);
    assert.match(pendingRes.text, /needs a Witness first/);
  });

  void test("the Record new species step on the form comes back as the form, the new Species settled", async () => {
    const step = await request(app()).get(`/admin/submissions/${witnessedId}/record-species`).query({ correction: "1" });
    assert.match(step.text, /<input type="hidden" name="correction" value="1"\/>/);
    assert.match(step.text, new RegExp(`hx-get="/admin/submissions/${witnessedId}/correct-points"[^>]*hx-select="#witnessPanel"[^>]*>Back<`));

    const res = await request(app())
      .post(`/admin/submissions/${witnessedId}/record-species`)
      .type("form")
      .send({ correction: "1", new_scientific_name: "Correctus novissimus", new_common_name: "Corrected Novelty", new_point_class: "15" });

    assert.strictEqual(res.headers["hx-retarget"], "#witnessPanel");
    assert.match(res.text, /Correct species and points/);
    assert.match(res.text, /id="witness-recording"/);
    assert.match(res.text, /id="witness-form"[^>]*hx-post="\/admin\/submissions\/\d+\/correct-points"/);
    assert.match(res.text, /name="points" value="15" id="witness-points-15" checked="checked"/);
    assert.match(res.text, /id="correction-save" type="submit">Save correction · 15 pts</);
    assert.strictEqual(await resolveSpecies({ latinName: "Correctus novissimus" }), null, "created only by Save");
  });

  void test("the sticky bar sums first-time on the correction form and names its button", async () => {
    const bar = await request(app())
      .post(`/admin/submissions/${witnessedId}/witness-summary`)
      .type("form")
      .send({ correction: "1", species_id: "7", species_settled: "1", points: "10", first_time_species: "on" });

    assert.match(bar.text, /id="witness-sum-lines">Base points 10 \+ First Time Species Bonus 5</);
    assert.match(bar.text, /id="correction-save" type="submit">Save correction · 15 pts</);
    assert.doesNotMatch(bar.text, /witness-confirm/);
  });
});

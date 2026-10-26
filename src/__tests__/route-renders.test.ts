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
import { getSubmissionById, setSubmissionSupplements } from "@/db/submissions";
import { createSpecies, resolveSpecies } from "@/species";
import { confirmWitness, resetNotifier, WITNESS_RESET_NOTE } from "@/lifecycle";
import { addNote, getNotesForSubmission } from "@/db/submission_notes";
import { createTestDatabase, type TestDatabase } from "./helpers/database";
import { createRawSubmissionFixture as createUnboundSubmission, ensureGuppySpecies } from "./helpers/fixtures";
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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

  void test("a scientific name the catalogue holds is refused at the step, beside the field, with This one on the Species that holds it", async () => {
    const guppy = await ensureGuppySpecies(testDb.db);

    const res = await request(app())
      .post(`/admin/submissions/${submissionId}/record-species`)
      .type("form")
      .send({ new_scientific_name: "poecilia  Reticulata", new_common_name: "Fancy guppy", new_point_class: "15", new_cares_species: "on" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-retarget"], undefined, "back into the Species card, not the panel with it settled");
    assert.match(res.text, /id="witness-record"/);
    assert.match(res.text, /id="new_scientific_name-error"[^>]*>The catalogue already has this species \(Guppy, Poecilia reticulata\)\. Tap This one to choose it\.</);
    assert.match(res.text, new RegExp(`id="witness-record-existing-choose" type="button" hx-post="/admin/submissions/${submissionId}/bind-species" hx-vals="\\{&quot;group_id&quot;:${guppy}\\}"`));
    assert.match(res.text, /name="new_scientific_name"[^>]*value="poecilia {2}Reticulata"/, "the values typed come back");
    assert.match(res.text, /id="witness-new-point-class-15" checked="checked"/);
    assert.doesNotMatch(res.text, /witness-recording|name="points"/);

    // On the correction form the step comes back as the step too, This one asking for the form with the Species
    const correcting = await request(app())
      .post(`/admin/submissions/${submissionId}/record-species`)
      .type("form")
      .send({ correction: "1", new_scientific_name: "Poecilia reticulata", new_point_class: "10" });
    assert.match(correcting.text, new RegExp(`id="witness-record-existing-choose" type="button" hx-get="/admin/submissions/${submissionId}/correct-points" hx-vals="\\{&quot;species_id&quot;:${guppy}\\}"`));
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  const app = () => appWith((a) => a.get("/submissions/:id", submission.view), committee);

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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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
 * The report on the Submission page, through the real route (#559): labels
 * for the Program, the HAP/CAP details the form captures, and supplements
 * loaded from their own table.
 */
void describe("The Submission page reports what its Program's form captured", () => {
  let testDb: TestDatabase;
  let memberId: number;
  let committeeId: number;

  beforeEach(async () => {
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("grower@example.com", "Ana Ruiz");
    committeeId = await createMember("committee@example.com", "Jane Ortiz");
  });
  afterEach(async () => {
    await testDb.cleanup();
  });

  const app = () => appWith((a) => a.get("/submissions/:id", submission.view));

  async function approved(fields: Record<string, string | null>, options: Partial<Parameters<typeof createUnboundSubmission>[1]> = {}) {
    const id = await createUnboundSubmission(testDb.db, {
      memberId,
      submitted: true,
      approved: true,
      witnessedBy: committeeId,
      approvedBy: committeeId,
      points: 10,
      ...options,
    });
    const entries = Object.entries(fields);
    if (entries.length > 0) {
      await testDb.db.run(
        `UPDATE submissions SET ${entries.map(([field]) => `${field} = ?`).join(", ")} WHERE id = ?`,
        [...entries.map(([, value]) => value), id]
      );
    }
    return id;
  }

  void test("HAP: propagation, lighting, CO₂ and every supplement, under plant labels", async () => {
    const id = await approved(
      {
        propagation_method: "Runners, then replanted",
        light_type: "LED",
        light_strength: "40 PAR",
        light_hours: "8",
        co2: "yes",
        co2_description: "Pressurised, 1 bubble per second",
        count: null,
      },
      { speciesType: "Plant", speciesClass: "Stem Plants", program: "plant", commonName: "Water wisteria", latinName: "Hygrophila difformis", foods: "[]", spawnLocations: "[]" }
    );
    await setSubmissionSupplements(id, [
      { type: "Root tabs", regimen: "Monthly" },
      { type: "Liquid fertilizer", regimen: "Twice weekly" },
    ]);

    const res = await request(app()).get(`/submissions/${id}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="reproduction_date-label">Date Propagated</);
    assert.match(res.text, /id="propagation_method"[^>]*>Runners, then replanted</);
    assert.match(res.text, /id="light_type"[^>]*>LED</);
    assert.match(res.text, /id="light_hours"[^>]*>8</);
    assert.match(res.text, /id="co2"[^>]*>Yes</);
    assert.match(res.text, /id="co2_description"[^>]*>Pressurised, 1 bubble per second</);
    assert.match(res.text, /Root tabs<\/span><span>Monthly</);
    assert.match(res.text, /Liquid fertilizer<\/span><span>Twice weekly</);
    assert.doesNotMatch(res.text, /# of Fry|Spawn Locations|Date Spawned/);
  });

  void test("BAP: fry, foods and spawn locations, and no plant sections", async () => {
    const id = await approved({ count: "40", co2: "no" }, { speciesId: await ensureGuppySpecies(testDb.db) });

    const res = await request(app()).get(`/submissions/${id}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="reproduction_date-label">Date Spawned</);
    assert.match(res.text, /id="count"[^>]*>40</);
    assert.match(res.text, /id="foods"[^>]*>Flakes, Live food</);
    assert.match(res.text, /id="spawn_locations"[^>]*>Plants, Spawning mop</);
    assert.doesNotMatch(res.text, /id="supplements"|Propagation Method|Lighting Type/);
  });

  void test("an older HAP report with nothing recorded says so, field by field", async () => {
    const id = await approved(
      { propagation_method: null, light_type: null, co2: null, count: null },
      { speciesType: "Plant", speciesClass: "Stem Plants", program: "plant", foods: "[]", spawnLocations: "[]" }
    );

    const res = await request(app()).get(`/submissions/${id}`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="propagation_method"[^>]*>Not recorded</);
    assert.match(res.text, /id="light_type"[^>]*>Not recorded</);
    assert.match(res.text, /id="co2"[^>]*>Not recorded</);
    assert.match(res.text, /id="supplement-list-empty"/);
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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
      a.get("/admin/witness-queue{/:program}", admin.showWitnessQueue);
      a.get("/admin/waiting-period{/:program}", admin.showWaitingPeriod);
      a.post("/admin/submissions/:id/approve", admin.approveSubmission);
    }, viewer);

  void test("screening combines programs, oldest first, with working filters and counts", async () => {
    const fishId = await submissionInState(testDb.db, "pendingWitness", {
      memberId: ownerId,
      program: "fish",
    });
    const plantId = await submissionInState(testDb.db, "pendingWitness", {
      memberId: ownerId,
      program: "plant",
    });
    await testDb.db.run("UPDATE submissions SET submitted_on = ? WHERE id = ?", [
      "2026-01-02",
      fishId,
    ]);
    await testDb.db.run("UPDATE submissions SET submitted_on = ? WHERE id = ?", [
      "2026-01-01",
      plantId,
    ]);
    const res = await request(app()).get("/admin/witness-queue");

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /All · 2<\/a>/);
    assert.match(res.text, /BAP · 1<\/a>/);
    assert.match(res.text, /HAP · 1<\/a>/);
    assert.match(res.text, new RegExp(`id="screening-row-${fishId}"`));
    assert.match(res.text, new RegExp(`href="/submissions/${plantId}\\?screening=all"[^>]*>Review submission`));
    assert.ok(
      res.text.indexOf(`id="screening-row-${plantId}"`) <
        res.text.indexOf(`id="screening-row-${fishId}"`)
    );
    assert.doesNotMatch(res.text, /<table|tablesort|waiting-period/);
    const filtered = await request(app()).get("/admin/witness-queue/plant");
    assert.match(filtered.text, new RegExp(`id="screening-row-${plantId}"`));
    assert.doesNotMatch(filtered.text, new RegExp(`id="screening-row-${fishId}"`));
    assert.match(filtered.text, /href="\/admin\/queue\/plant"/);
    assert.match(filtered.text, new RegExp(`href="/submissions/${plantId}\\?screening=plant"`));
    assert.strictEqual((await request(app()).get("/admin/witness-queue/invalid")).status, 404);
  });

  void test("screening explains own submissions and excludes work sent back to the member", async () => {
    const ownId = await submissionInState(testDb.db, "pendingWitness", { memberId: committeeId });
    const returnedId = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
    await testDb.db.run("UPDATE submissions SET changes_requested_on = ? WHERE id = ?", [
      new Date().toISOString(),
      returnedId,
    ]);
    const res = await request(app()).get("/admin/witness-queue");

    assert.match(res.text, new RegExp(`id="screening-row-${ownId}"`));
    assert.match(res.text, /Your own submission. Another committee member screens it./);
    assert.match(res.text, new RegExp(`href="/submissions/${ownId}\\?screening=all"[^>]*>View submission`));
    assert.doesNotMatch(res.text, /Review submission/);
    assert.doesNotMatch(res.text, new RegExp(`screening-row-${returnedId}`));
  });

  void test("empty screening keeps the queue and program navigation available", async () => {
    const res = await request(app()).get("/admin/witness-queue/coral");
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /id="queue-screening-empty"/);
    assert.match(res.text, /href="\/admin\/queue\/coral"/);
    assert.match(res.text, /href="\/admin\/witness-queue"/);
    assert.match(res.text, /CAP · 0/);
  });

  void test("waiting bookmarks redirect to the approval section, preserving the program", async () => {
    for (const program of ["", "/fish", "/plant", "/coral"]) {
      const res = await request(app()).get(`/admin/waiting-period${program}`);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.location, `/admin/queue${program}#queue-waiting`);
    }
    assert.strictEqual((await request(app()).get("/admin/waiting-period/invalid")).status, 404);
    const approval = await request(app()).get("/admin/queue/plant");
    assert.match(approval.text, /href="\/admin\/witness-queue\/plant"/);
    assert.doesNotMatch(approval.text, /href="[^"]*waiting-period/);
  });

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

  void test("waiting distinguishes outstanding member changes from clock-only work", async () => {
    const waitingId = await submissionInState(testDb.db, "waitingPeriod", { memberId: ownerId, witnessedBy: committeeId });
    await testDb.db.run("UPDATE submissions SET changes_requested_on = ? WHERE id = ?", [
      new Date().toISOString(), waitingId,
    ]);
    const res = await request(app()).get("/admin/queue");
    assert.strictEqual(res.status, 200);
    assert.match(res.text, new RegExp(`id="queue-waiting-${waitingId}"[^>]*>[\\s\\S]*?Awaiting member changes[\\s\\S]*?Waiting period ends`));
    assert.match(res.text, /stay out of approval until resubmitted/);
    assert.doesNotMatch(res.text, new RegExp(`id="queue-row-${waitingId}"`));
  });

  void test("rows show the Species the witness settled, common and Latin, not the member's spelling", async () => {
    const barb = await createSpecies({
      canonicalGenus: "Puntius",
      canonicalSpeciesName: "queuetestus",
      programClass: "Cyprinids",
      speciesType: "Fish",
      pointClass: 10,
      commonName: "Queue Barb",
    });
    const spelt = { commonName: "Longfin Rosey Barbs", latinName: "Puntius stagingtestus", memberId: ownerId, witnessedBy: committeeId, speciesId: barb, points: 10 };
    const ready = await submissionInState(testDb.db, "inApprovalQueue", spelt);
    const waiting = await submissionInState(testDb.db, "waitingPeriod", spelt);
    const approved = await submissionInState(testDb.db, "approved", spelt);

    const res = await request(app()).get("/admin/queue");

    assert.match(res.text, new RegExp(`id="queue-species-${ready}">Queue Barb <i class="text-gray-500">Puntius queuetestus</i>`));
    assert.match(res.text, new RegExp(`id="queue-waiting-${waiting}"[\\s\\S]*?Dan Wu · Queue Barb`));
    assert.match(res.text, new RegExp(`id="queue-approved-${approved}"[\\s\\S]*?Dan Wu · Queue Barb`));
    assert.doesNotMatch(res.text, /Longfin Rosey Barbs|stagingtestus/);
  });

  void test("a Species with no common Name goes by its Latin one; an unbound row has only the member's spelling", async () => {
    const nameless = await createSpecies({ canonicalGenus: "Ilyodon", canonicalSpeciesName: "queuetestus", programClass: "Livebearers", speciesType: "Fish", pointClass: 10 });
    const latinOnly = await submissionInState(testDb.db, "inApprovalQueue", { memberId: ownerId, witnessedBy: committeeId, speciesId: nameless, points: 10, commonName: "White's goodeid" });
    const unbound = await submissionInState(testDb.db, "waitingPeriod", { memberId: ownerId, witnessedBy: committeeId, speciesId: null, commonName: "Mystery fish", latinName: "Genus incognita" });

    const res = await request(app()).get("/admin/queue");

    assert.match(res.text, new RegExp(`id="queue-species-${latinOnly}">Ilyodon queuetestus</div>`));
    assert.doesNotMatch(res.text, /White's goodeid|White&#39;s goodeid/);
    assert.match(res.text, new RegExp(`id="queue-waiting-${unbound}"[\\s\\S]*?Dan Wu · Mystery fish`));
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
    const page = appWith((a) => a.get("/submissions/:id", submission.view), committee);
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
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
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

  // Submit the successful controls actually rendered by the form, rather
  // than hand-constructing an ideal request that could hide template drift.
  function correctionControls(html: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const [input] of html.matchAll(/<input\b[^>]*>/g)) {
      const name = /\bname="([^"]+)"/.exec(input)?.[1];
      const value = /\bvalue="([^"]*)"/.exec(input)?.[1];
      if (!name || value === undefined) continue;
      if (/type="(?:radio|checkbox)"/.test(input) && !/\bchecked(?:[= >])/.test(input)) continue;
      fields[name] = value;
    }
    return fields;
  }

  for (const approved of [false, true]) {
    for (const target of ["fish", "plant", "coral"] as const) {
      void test(`changing Program to ${target} ${approved ? "after" : "before"} approval clears every rendered, summed and saved bonus`, async () => {
        const source = target === "plant" ? "fish" : "plant";
        const originalSpecies = await createSpecies({
          canonicalGenus: "Originalus", canonicalSpeciesName: "example",
          speciesType: source === "plant" ? "Plant" : "Fish",
          programClass: source === "plant" ? "Cryptocoryne" : "Livebearers", pointClass: 10,
        });
        const chosenSpecies = await createSpecies({
          canonicalGenus: "Correctus", canonicalSpeciesName: "example",
          speciesType: target === "plant" ? "Plant" : target === "coral" ? "Coral" : "Fish",
          programClass: target === "plant" ? "Cryptocoryne" : target === "coral" ? "Soft Corals" : "Livebearers",
          pointClass: 15, isCaresSpecies: target === "fish",
        });
        const id = await submissionInState(testDb.db, approved ? "approved" : "waitingPeriod", {
          memberId: ownerId, witnessedBy: committeeId, speciesId: originalSpecies,
          program: source, speciesType: source === "plant" ? "Plant" : "Fish",
          points: 10, articlePoints: 10, firstTimeSpecies: approved, caresSpecies: source === "fish",
        });
        if (source === "plant") {
          await testDb.db.run("UPDATE submissions SET flowered = 1, sexual_reproduction = 1 WHERE id = ?", id);
        }
        const before = await getSubmissionById(id);
        const res = await request(app()).get(`/admin/submissions/${id}/correct-points`)
          .query({ species_id: chosenSpecies }).set("HX-Request", "true");
        assert.strictEqual(res.status, 200);
        assert.match(res.text, /id="correction-bonuses-reset"/);
        assert.match(res.text, /All bonuses have been cleared/);
        assert.match(res.text, /Save correction · 15 pts/);
        assert.strictEqual(/name="first_time_species"/.test(res.text), approved);
        assert.strictEqual(/name="cares_species"/.test(res.text), target === "fish");
        assert.strictEqual(/name="flowered"/.test(res.text), target === "plant");
        assert.strictEqual(/name="sexual_reproduction"/.test(res.text), target === "plant");
        const body = correctionControls(res.text);
        assert.strictEqual(body.points, "15");
        assert.strictEqual(body.article_points, "0");
        for (const flag of ["cares_species", "flowered", "sexual_reproduction", "first_time_species"]) {
          assert.strictEqual(body[flag], undefined, `${flag} starts unchecked`);
        }
        const refresh = await request(app()).post(`/admin/submissions/${id}/witness-summary`).type("form").send(body);
        assert.match(refresh.text, /Save correction · 15 pts/);
        assert.deepStrictEqual(await getSubmissionById(id), before, "preparation and refresh write nothing");
        const save = await request(app()).post(`/admin/submissions/${id}/correct-points`).type("form")
          .send({ ...body, reason: "The Species belongs to a different Program" });
        assert.strictEqual(save.headers["hx-redirect"], `/submissions/${id}`);
        const after = (await getSubmissionById(id))!;
        assert.strictEqual(after.program, target);
        assert.strictEqual(after.species_id, chosenSpecies);
        assert.strictEqual(after.points, 15);
        assert.ok(!after.article_points);
        assert.strictEqual(after.cares_species, 0);
        assert.strictEqual(after.flowered, 0);
        assert.strictEqual(after.sexual_reproduction, 0);
        assert.strictEqual(after.first_time_species, approved ? 0 : null);
        assert.strictEqual(after.witnessed_on, before!.witnessed_on);
        assert.strictEqual(after.approved_on, before!.approved_on);
      });
    }
  }

  void test("after a Program reset new bonus choices survive summary refresh and Save", async () => {
    const plant = await createSpecies({
      canonicalGenus: "Cryptocoryne", canonicalSpeciesName: "example",
      speciesType: "Plant", programClass: "Cryptocoryne", pointClass: 15,
    });
    const panel = await request(app()).get(`/admin/submissions/${witnessedId}/correct-points`).query({ species_id: plant });
    const body = { ...correctionControls(panel.text), article_points: "5", flowered: "on" };
    const refresh = await request(app()).post(`/admin/submissions/${witnessedId}/witness-summary`).type("form").send(body);
    assert.match(refresh.text, /Save correction · 35 pts/);
    const saved = await request(app()).post(`/admin/submissions/${witnessedId}/correct-points`).type("form")
      .send({ ...body, reason: "The article describes the flowering plant" });
    assert.strictEqual(saved.headers["hx-redirect"], `/submissions/${witnessedId}`);
    const after = (await getSubmissionById(witnessedId))!;
    assert.strictEqual(after.article_points, 5);
    assert.strictEqual(after.flowered, 1);
    assert.strictEqual(after.cares_species, 0);
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

  void test("the sticky bar sums first-time only on an Approved correction and names its button", async () => {
    const approvedId = await submissionInState(testDb.db, "approved", { memberId: ownerId, witnessedBy: committeeId, points: 10 });
    const fields = { correction: "1", species_settled: "1", points: "10", first_time_species: "on" };
    const bar = await request(app()).post(`/admin/submissions/${approvedId}/witness-summary`).type("form").send(fields);
    assert.match(bar.text, /id="witness-sum-lines">Base points 10 \+ First Time Species Bonus 5</);
    assert.match(bar.text, /id="correction-save" type="submit">Save correction · 15 pts</);
    assert.doesNotMatch(bar.text, /witness-confirm/);
    const early = await request(app()).post(`/admin/submissions/${witnessedId}/witness-summary`).type("form").send(fields);
    assert.match(early.text, /Save correction · 10 pts/);
    assert.doesNotMatch(early.text, /First Time Species Bonus/);
  });
});

void describe("The Edit Approved dialog edits details only", () => {
  let testDb: TestDatabase;
  let committee: MulmRequest["viewer"];
  let committeeId: number;
  let ownerId: number;
  let approvedId: number;
  let sent: ReturnType<typeof recordNotifications>;

  beforeEach(async () => {
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    sent = recordNotifications();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    approvedId = await submissionInState(testDb.db, "approved", {
      memberId: ownerId,
      witnessedBy: committeeId,
      points: 10,
    });
  });
  afterEach(async () => {
    resetNotifier();
    await testDb.cleanup();
  });

  const app = (viewer: MulmRequest["viewer"] = committee) =>
    appWith((a) => {
      a.use(express.urlencoded({ extended: true }));
      a.get("/admin/submissions/:id/edit-approved", admin.editApprovedSubmissionForm);
      a.post("/admin/submissions/:id/edit-approved", admin.saveApprovedSubmissionEdits);
    }, viewer);

  void test("the dialog carries the details and a link to the correction form, and no Species or points fields", async () => {
    const res = await request(app()).get(`/admin/submissions/${approvedId}/edit-approved`);

    assert.strictEqual(res.status, 200);
    assert.match(res.text, /Edit Approved Submission/);
    assert.match(res.text, /Dan Wu/);
    assert.match(res.text, /name="tank_size"/);
    assert.match(res.text, /name="reason"/);
    assert.match(res.text, new RegExp(`id="edit-approved-correct-link" href="/admin/submissions/${approvedId}/correct-points"`));
    assert.doesNotMatch(res.text, /name="points"|name="group_id"|name="first_time_species"|name="cares_species"|name="article_points"/);
  });

  void test("saving writes the details with the reason on the changelog, returns to the Submission, and tells nobody", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({
        tank_size: "20 gallon",
        temperature: "78",
        foods: ["Frozen", "Pellets"],
        reproduction_date: "2024-02-01",
        reason: "The paper form says a 20 gallon tank",
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-redirect"], `/submissions/${approvedId}`);
    const row = (await getSubmissionById(approvedId))!;
    assert.strictEqual(row.tank_size, "20 gallon");
    assert.strictEqual(row.temperature, "78");
    assert.strictEqual(row.foods, JSON.stringify(["Frozen", "Pellets"]));
    assert.match(row.reproduction_date, /^2024-02-01T/, "the day moved, the time of day kept");
    assert.strictEqual(row.points, 10, "not a points edit");
    assert.ok(row.approved_on, "still Approved");

    const notes = await getNotesForSubmission(approvedId);
    assert.strictEqual(notes.length, 1);
    const note = JSON.parse(notes[0].note_text) as { type: string; reason: string; changes: { field: string }[] };
    assert.strictEqual(note.type, "admin_edit");
    assert.strictEqual(note.reason, "The paper form says a 20 gallon tank");
    assert.deepStrictEqual(note.changes.map((c) => c.field).sort(), ["foods", "reproduction_date", "tank_size", "temperature"]);
    assert.deepStrictEqual(sent.kinds, [], "no email of any kind");
  });

  void test("the day the dialog showed, posted back unchanged, is no edit: only the fields that moved reach the changelog", async () => {
    const stored = (await getSubmissionById(approvedId))!.reproduction_date;
    const shownDay = new Date(stored).toISOString().split("T")[0];

    const res = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({ count: "40", reproduction_date: shownDay, reason: "The member counted again" });

    assert.strictEqual(res.headers["hx-redirect"], `/submissions/${approvedId}`);
    const row = (await getSubmissionById(approvedId))!;
    assert.strictEqual(row.count, "40");
    assert.strictEqual(row.reproduction_date, stored, "the instant is left exactly as stored");
    const notes = await getNotesForSubmission(approvedId);
    assert.strictEqual(notes.length, 1);
    const note = JSON.parse(notes[0].note_text) as { changes: { field: string }[] };
    assert.deepStrictEqual(note.changes.map((c) => c.field), ["count"]);

    // The day alone, unchanged, is nothing to save
    const nothing = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({ reproduction_date: shownDay, reason: "Looked at it again" });
    assert.strictEqual(nothing.headers["hx-retarget"], "#edit-approved-errors");
    assert.match(nothing.text, /No changes detected/);
  });

  void test("a points or Species field in the body is dropped: the dialog cannot change them", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({ tank_size: "20 gallon", points: "20", group_id: "999", first_time_species: "1", reason: "Trying it on" });

    assert.strictEqual(res.headers["hx-redirect"], `/submissions/${approvedId}`);
    const row = (await getSubmissionById(approvedId))!;
    assert.strictEqual(row.tank_size, "20 gallon");
    assert.strictEqual(row.points, 10);
    assert.strictEqual(row.species_id, await ensureGuppySpecies(testDb.db));
  });

  void test("a refusal lands in the dialog's banner: no reason, or nothing changed", async () => {
    const noReason = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({ tank_size: "20 gallon" });
    assert.strictEqual(noReason.status, 200);
    assert.strictEqual(noReason.headers["hx-retarget"], "#edit-approved-errors");
    assert.match(noReason.text, /Say why the details are being changed/);

    const before = (await getSubmissionById(approvedId))!;
    const unchanged = await request(app())
      .post(`/admin/submissions/${approvedId}/edit-approved`)
      .type("form")
      .send({ tank_size: before.tank_size ?? "", reason: "Nothing really" });
    assert.strictEqual(unchanged.headers["hx-retarget"], "#edit-approved-errors");
    assert.match(unchanged.text, /No changes detected/);
    assert.strictEqual((await getNotesForSubmission(approvedId)).length, 0);
  });

  void test("the committee's own Submission and one not yet Approved get no dialog", async () => {
    const own = await submissionInState(testDb.db, "approved", { memberId: committeeId, witnessedBy: ownerId });
    const ownRes = await request(app()).get(`/admin/submissions/${own}/edit-approved`);
    assert.strictEqual(ownRes.status, 403);
    const ownSave = await request(app()).post(`/admin/submissions/${own}/edit-approved`).type("form").send({ tank_size: "20", reason: "Mine" });
    assert.strictEqual(ownSave.status, 403);

    const waiting = await submissionInState(testDb.db, "waitingPeriod", { memberId: ownerId, witnessedBy: committeeId });
    const waitingRes = await request(app()).get(`/admin/submissions/${waiting}/edit-approved`);
    assert.strictEqual(waitingRes.status, 400);
    const waitingSave = await request(app()).post(`/admin/submissions/${waiting}/edit-approved`).type("form").send({ tank_size: "20", reason: "Early" });
    assert.strictEqual(waitingSave.status, 400);
    assert.notStrictEqual((await getSubmissionById(waiting))!.tank_size, "20");
  });
});

/**
 * The witness panel's confirm (#521), through the route: a valid body lands
 * the Witness and sends the witness to the queue of the Program the
 * Submission settled in; a refused one comes back into the panel's alert and
 * writes nothing.
 */
void describe("The witness confirms from the panel", () => {
  let testDb: TestDatabase;
  let committee: MulmRequest["viewer"];
  let committeeId: number;
  let ownerId: number;
  let pendingId: number;
  let guppy: number;

  beforeEach(async () => {
    testDb = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    recordNotifications();
    ownerId = await createMember("breeder@example.com", "Dan Wu");
    committeeId = await createMember("witness@example.com", "Jane Ortiz");
    committee = { id: committeeId, display_name: "Jane Ortiz", contact_email: "witness@example.com", is_admin: true };
    guppy = await ensureGuppySpecies(testDb.db);
    pendingId = await submissionInState(testDb.db, "pendingWitness", { memberId: ownerId });
  });
  afterEach(async () => {
    resetNotifier();
    await testDb.cleanup();
  });

  const app = (viewer: MulmRequest["viewer"] = committee) =>
    appWith((a) => {
      a.use(express.urlencoded({ extended: true }));
      a.get("/submissions/:id", submission.view);
      a.post("/admin/submissions/:id/confirm-witness", admin.confirmWitnessAction);
      a.post("/admin/submissions/:id/request-changes", admin.sendRequestChanges);
    }, viewer);

  const confirm = (id: number, body: Record<string, string>) =>
    request(app()).post(`/admin/submissions/${id}/confirm-witness`).type("form").send(body);

  void test("a valid body confirms the Witness with its points and redirects to the Program's witness queue", async () => {
    const res = await confirm(pendingId, { species_id: String(guppy), points: "10", article_points: "5", cares_species: "on" });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["hx-redirect"], "/admin/witness-queue/fish");
    const row = (await getSubmissionById(pendingId))!;
    assert.strictEqual(row.witness_verification_status, "confirmed");
    assert.strictEqual(row.witnessed_by, committeeId);
    assert.strictEqual(row.points, 10);
    assert.strictEqual(row.article_points, 5);
    assert.strictEqual(row.cares_species, 1);
    assert.strictEqual(row.species_id, guppy);
  });

  for (const filter of ["all", "fish", "plant", "coral"]) {
    void test(`confirmation returns to the originating ${filter} screening filter`, async () => {
      const res = await request(app())
        .post(`/admin/submissions/${pendingId}/confirm-witness`)
        .set("HX-Current-URL", `https://example.test/submissions/${pendingId}?screening=${filter}`)
        .type("form").send({ species_id: String(guppy), points: "10" });
      assert.strictEqual(res.headers["hx-redirect"], `/admin/witness-queue${filter === "all" ? "" : `/${filter}`}`);
      assert.strictEqual((await getSubmissionById(pendingId))!.witness_verification_status, "confirmed");
    });
  }

  for (const current of ["not a URL", "https://example.test/submissions/999999?screening=all", "https://example.test/submissions/ID?screening=https://evil.test", "https://example.test/submissions/ID?screening=invalid"]) {
    void test(`confirmation ignores invalid queue context: ${current}`, async () => {
      const res = await request(app())
        .post(`/admin/submissions/${pendingId}/confirm-witness`)
        .set("HX-Current-URL", current.replace("/ID", `/${pendingId}`))
        .type("form").send({ species_id: String(guppy), points: "10" });
      assert.strictEqual(res.headers["hx-redirect"], "/admin/witness-queue/fish");
    });
  }

  void test("requesting changes returns to the originating screening queue", async () => {
    const res = await request(app())
      .post(`/admin/submissions/${pendingId}/request-changes`)
      .set("HX-Current-URL", `https://example.test/submissions/${pendingId}?screening=all`)
      .type("form").send({ content: "Please add a photo of the fry" });
    assert.strictEqual(res.headers["hx-redirect"], "/admin/witness-queue");
    assert.ok((await getSubmissionById(pendingId))!.changes_requested_on);
  });

  void test("a refusal renders into the panel's alert and writes nothing: points outside the classes, a HAP bonus on a fish", async () => {
    const seven = await confirm(pendingId, { species_id: String(guppy), points: "7" });
    assert.strictEqual(seven.status, 200);
    assert.strictEqual(seven.headers["hx-retarget"], "#committee-error");
    assert.strictEqual(seven.headers["hx-reswap"], "innerHTML");
    assert.strictEqual(seven.headers["hx-redirect"], undefined);
    assert.match(seven.text, /Not done:/);
    assert.match(seven.text, /Base points must be 5, 10, 15 or 20/);

    const flowered = await confirm(pendingId, { species_id: String(guppy), points: "10", flowered: "on" });
    assert.strictEqual(flowered.headers["hx-retarget"], "#committee-error");
    assert.match(flowered.text, /The flowered bonus does not apply to Breeders Awards Program submissions/);

    const row = (await getSubmissionById(pendingId))!;
    assert.strictEqual(row.witness_verification_status, "pending");
    assert.strictEqual(row.witnessed_by, null);
    assert.strictEqual(row.points, null);
    assert.strictEqual(row.flowered, null);
  });

  void test("settled on a plant Species, a fish Submission leaves as a HAP row and the redirect follows it", async () => {
    const plant = await createSpecies({
      canonicalGenus: "Cryptocoryne",
      canonicalSpeciesName: "witnessata",
      programClass: "Cryptocoryne",
      speciesType: "Plant",
      pointClass: 10,
    });

    const res = await confirm(pendingId, { species_id: String(plant), points: "10", flowered: "on" });

    assert.strictEqual(res.headers["hx-redirect"], "/admin/witness-queue/plant");
    const row = (await getSubmissionById(pendingId))!;
    assert.strictEqual(row.program, "plant");
    assert.strictEqual(row.species_id, plant);
    assert.strictEqual(row.flowered, 1);
    assert.strictEqual(row.witness_verification_status, "confirmed");
  });

  void test("the panel asks 'Is that right?' again once the member has saved since the committee chose the Species", async () => {
    await addNote(
      pendingId,
      committeeId,
      JSON.stringify({ type: "admin_edit", changes: [{ field: "species", old: null, new: "Poecilia reticulata" }], reason: "Bound to a Species" })
    );
    const chosen = await request(app()).get(`/submissions/${pendingId}`);
    assert.strictEqual(chosen.status, 200);
    assert.match(chosen.text, /id="witness-chooser">You chose</);
    assert.doesNotMatch(chosen.text, /Is that right\?/);

    // Another committee member sees who chose it, by name
    const otherId = await createMember("other@example.com", "Don Lang");
    const other = appWith((a) => a.get("/submissions/:id", submission.view), { id: otherId, display_name: "Don Lang", contact_email: "other@example.com", is_admin: true });
    const theirs = await request(other).get(`/submissions/${pendingId}`);
    assert.match(theirs.text, /id="witness-chooser">Jane Ortiz chose</);
    assert.doesNotMatch(theirs.text, /You chose/);

    await addNote(pendingId, ownerId, JSON.stringify({ type: "member_save", voided: "choice", member_id: ownerId, timestamp: new Date().toISOString() }));
    const saved = await request(app()).get(`/submissions/${pendingId}`);
    assert.strictEqual(saved.status, 200);
    assert.match(saved.text, /Is that right\?/);
    assert.doesNotMatch(saved.text, /You chose/);
    // The save is one line on the changelog saying what it voided, not raw JSON
    assert.match(saved.text, /Dan Wu<\/span> saved the form<span[^>]*>[^<]*<\/span>\. The committee's choice of Species is asked again\./);
    assert.doesNotMatch(saved.text, /member_save|Witness confirmed before this/);

    await addNote(pendingId, ownerId, JSON.stringify({ type: "member_save", voided: "witness", member_id: ownerId, timestamp: new Date().toISOString() }));
    const witnessed = await request(app()).get(`/submissions/${pendingId}`);
    assert.match(witnessed.text, /saved the form<span[^>]*>[^<]*<\/span>\. A Witness confirmed before this is void\./);
  });
});

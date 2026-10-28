import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import request from "supertest";
import { createApp } from "../app";
import { createAdminToken } from "../db/adminTokens";
import { addToCollection } from "../db/collection";
import { createCanonicalRecommendation } from "../db/iucn";
import { createMember } from "../db/members";
import * as catalogue from "../species";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

const password = "Good test password 42!";
const email = "species-api-admin@example.test";

let fixture: TestDatabase;
let adminId: number;
let token: string;
let betta: number;
let guppy: number;

const app = () => createApp({ env: { NODE_ENV: "test" } });
const auth = () => ({ Authorization: `Bearer ${token}` });
const api = {
  get: (path: string) => request(app()).get(`/api/admin/species${path}`).set(auth()),
  post: (path: string, body: object = {}) =>
    request(app()).post(`/api/admin/species${path}`).set(auth()).send(body),
  patch: (path: string, body: object = {}) =>
    request(app()).patch(`/api/admin/species${path}`).set(auth()).send(body),
  put: (path: string, body: object = {}) =>
    request(app()).put(`/api/admin/species${path}`).set(auth()).send(body),
  delete: (path: string) => request(app()).delete(`/api/admin/species${path}`).set(auth()),
};

beforeEach(async () => {
  fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
  adminId = await createMember(email, "Species Admin", { password });
  await fixture.db.run("UPDATE members SET is_admin = 1 WHERE id = ?", adminId);
  ({ token } = await createAdminToken(adminId, "test"));
  betta = await catalogue.createSpecies({
    programClass: "API Class A",
    speciesType: "Fish",
    canonicalGenus: "Fakebetta",
    canonicalSpeciesName: "alphaensis",
    pointClass: 10,
  });
  guppy = await catalogue.createSpecies({
    programClass: "API Class B",
    speciesType: "Fish",
    canonicalGenus: "Fakepoecilia",
    canonicalSpeciesName: "betaensis",
  });
  await catalogue.addName(betta, "common", "Zzapi fighting fish");
});
afterEach(async () => fixture.cleanup());

void describe("/api/admin/species authentication", () => {
  void test("an admin's session cookie alone is 401 on every species endpoint", async () => {
    const agent = request.agent(app());
    await agent
      .post("/auth/login")
      .set("Origin", "http://localhost:4200")
      .type("form")
      .send({ email, password })
      .expect(200);
    const res = await agent.get("/api/admin/species").expect(401);
    assert.equal(res.body.error, "unauthorized");
    await agent.get(`/api/admin/species/${betta}`).expect(401);
    await agent.delete(`/api/admin/species/${betta}`).expect(401);
    assert.ok(await catalogue.findSpeciesById(betta));
  });
});

void describe("/api/admin/species", () => {
  void test("GET / searches, filters, pages and counts", async () => {
    const all = await api.get("/?q=Fake").expect(200);
    assert.equal(all.body.total_count, 2);
    assert.deepEqual(
      all.body.species.map((s: { group_id: number }) => s.group_id),
      [betta, guppy]
    );
    const found = await api.get("/?q=zzapi%20fighting").expect(200);
    assert.equal(found.body.total_count, 1);
    assert.equal(found.body.species[0].canonical_genus, "Fakebetta");
    assert.equal(found.body.species[0].is_cares_species, false);
    const pointed = await api.get("/?q=Fake&has_base_points=true&limit=1").expect(200);
    assert.deepEqual(
      pointed.body.species.map((s: { group_id: number }) => s.group_id),
      [betta]
    );
    assert.deepEqual((await api.get("/?q=Fake&count_only=true").expect(200)).body, {
      total_count: 2,
    });
    const bad = await api.get("/?species_type=Bird&limit=-1").expect(400);
    assert.equal(bad.body.error, "bad_request");
    assert.match(bad.body.message, /species_type/);
  });

  void test("GET /:id returns the Species with its Names, 404 when missing, 400 on a bad id", async () => {
    const res = await api.get(`/${betta}`).expect(200);
    assert.equal(res.body.group_id, betta);
    assert.deepEqual(
      res.body.names.common.map((n: { name: string }) => n.name),
      ["Zzapi fighting fish"]
    );
    assert.equal((await api.get("/999999").expect(404)).body.error, "not_found");
    await api.get("/abc").expect(400);
  });

  void test("POST / creates a Species (201), refuses a bad body (400) and a taken Canonical name (409)", async () => {
    const res = await api
      .post("/", {
        program_class: "Cichlids",
        canonical_genus: "Fakeapisto",
        canonical_species_name: "cacatuoides",
        species_type: "Fish",
        base_points: 15,
        is_cares_species: true,
      })
      .expect(201);
    assert.equal(res.headers.location, `/api/admin/species/${res.body.group_id}`);
    assert.equal(res.body.base_points, 15);
    assert.equal(res.body.is_cares_species, 1);
    const created = await catalogue.findSpeciesById(res.body.group_id);
    assert.equal(created?.canonical_genus, "Fakeapisto");

    await api
      .post("/", {
        program_class: "Cichlids",
        canonical_genus: "X",
        canonical_species_name: "y",
        species_type: "Fish",
        base_points: 7,
      })
      .expect(400);
    const taken = await api
      .post("/", {
        program_class: "API Class A",
        canonical_genus: "Fakebetta",
        canonical_species_name: "alphaensis",
        species_type: "Fish",
      })
      .expect(409);
    assert.equal(taken.body.error, "conflict");
  });

  void test("PATCH /:id updates Program class, Point class and CARES flag; 400 empty, 404 missing", async () => {
    const res = await api
      .patch(`/${betta}`, { program_class: "Labyrinth", base_points: null, is_cares_species: true })
      .expect(200);
    assert.equal(res.body.program_class, "Labyrinth");
    assert.equal(res.body.base_points, null);
    assert.equal(res.body.is_cares_species, 1);
    await api.patch(`/${betta}`, {}).expect(400);
    await api.patch(`/${betta}`, { base_points: 12 }).expect(400);
    await api.patch("/999999", { is_cares_species: true }).expect(404);
  });

  void test("DELETE /:id deletes (204), 404 when missing, 409 while a collection entry references it", async () => {
    await api.delete(`/${guppy}`).expect(204);
    assert.equal(await catalogue.findSpeciesById(guppy), undefined);
    await api.delete(`/${guppy}`).expect(404);
    await addToCollection(adminId, { group_id: betta });
    const res = await api.delete(`/${betta}`).expect(409);
    assert.equal(res.body.error, "conflict");
    assert.ok(await catalogue.findSpeciesById(betta));
  });

  void test("PATCH /:id/canonical-name renames and keeps the old name; 400, 404, 409", async () => {
    const res = await api
      .patch(`/${betta}/canonical-name`, { canonical_genus: "Fakebettax" })
      .expect(200);
    assert.equal(res.body.canonical_genus, "Fakebettax");
    assert.ok(
      res.body.names.scientific.some((n: { name: string }) => n.name === "Fakebetta alphaensis")
    );
    await api.patch(`/${betta}/canonical-name`, {}).expect(400);
    await api.patch(`/999999/canonical-name`, { canonical_genus: "X" }).expect(404);
    await api
      .patch(`/${guppy}/canonical-name`, {
        canonical_genus: "Fakebettax",
        canonical_species_name: "alphaensis",
      })
      .expect(409);
  });

  void test("PUT /:id/external-data replaces each list given, leaves one left out, and stamps the sync", async () => {
    const first = await api
      .put(`/${betta}/external-data`, {
        external_references: ["https://a.example/1", "https://a.example/2"],
        image_links: ["https://img.example/1.jpg"],
      })
      .expect(200);
    assert.deepEqual(first.body.external_references, [
      "https://a.example/1",
      "https://a.example/2",
    ]);
    assert.deepEqual(first.body.image_links, ["https://img.example/1.jpg"]);
    const stamped = await fixture.db.get<{ last_external_sync: string | null }>(
      "SELECT last_external_sync FROM species_name_group WHERE group_id = ?",
      betta
    );
    assert.equal(stamped?.last_external_sync, first.body.last_external_sync);

    const second = await api
      .put(`/${betta}/external-data`, { external_references: ["https://b.example/only"] })
      .expect(200);
    assert.deepEqual(second.body.external_references, ["https://b.example/only"]);
    assert.deepEqual(second.body.image_links, ["https://img.example/1.jpg"]);

    const cleared = await api.put(`/${betta}/external-data`, { image_links: [] }).expect(200);
    assert.deepEqual(cleared.body.image_links, []);

    await api.put(`/${betta}/external-data`, {}).expect(400);
    await api.put(`/999999/external-data`, { image_links: [] }).expect(404);
  });

  void test("POST /:id/merge previews without writing, then merges; 404 and 400 on bad targets", async () => {
    const preview = await api
      .post(`/${betta}/merge`, { defunct_group_id: guppy, preview: true })
      .expect(200);
    assert.equal(preview.body.preview, true);
    assert.equal(preview.body.defunct_name, "Fakepoecilia betaensis");
    assert.ok(await catalogue.findSpeciesById(guppy));

    await api.post(`/${betta}/merge`, { defunct_group_id: 999999 }).expect(404);
    await api.post(`/${betta}/merge`, { defunct_group_id: betta }).expect(400);
    await api.post(`/${betta}/merge`, {}).expect(400);

    const merged = await api.post(`/${betta}/merge`, { defunct_group_id: guppy }).expect(200);
    assert.equal(merged.body.preview, false);
    assert.equal(await catalogue.findSpeciesById(guppy), undefined);
    const names = await catalogue.listNames(betta);
    assert.ok(names.scientific.some((n) => n.name === "Fakepoecilia betaensis"));
  });

  void test("POST /point-class sets Point classes by ids or filters, with preview", async () => {
    const preview = await api
      .post("/point-class", { group_ids: [betta, guppy], base_points: 20, preview: true })
      .expect(200);
    assert.equal(preview.body.updated_count, 2);
    assert.equal((await catalogue.findSpeciesById(guppy))?.base_points, null);

    const res = await api
      .post("/point-class", { program_class: "API Class B", base_points: 5 })
      .expect(200);
    assert.equal(res.body.updated_count, 1);
    assert.deepEqual(res.body.species, [
      {
        group_id: guppy,
        canonical_name: "Fakepoecilia betaensis",
        old_points: null,
        new_points: 5,
      },
    ]);
    assert.equal((await catalogue.findSpeciesById(guppy))?.base_points, 5);

    await api.post("/point-class", { group_ids: [betta], base_points: 7 }).expect(400);
    await api
      .post("/point-class", { group_ids: [betta], program_class: "API Class B", base_points: 5 })
      .expect(400);
  });
});

void describe("/api/admin/species names", () => {
  void test("POST /:id/names adds a Name (201); 400 bad kind, 404 missing Species, 409 duplicate", async () => {
    const res = await api
      .post(`/${guppy}/names`, { kind: "common", name: " Zzapi guppy " })
      .expect(201);
    assert.equal(res.body.name, "Zzapi guppy");
    assert.equal(res.body.group_id, guppy);
    await api.post(`/${guppy}/names`, { kind: "nickname", name: "x" }).expect(400);
    await api.post(`/999999/names`, { kind: "common", name: "x" }).expect(404);
    await api.post(`/${guppy}/names`, { kind: "common", name: "Zzapi guppy" }).expect(409);
  });

  void test("GET /names finds Names by text across Species", async () => {
    const res = await api.get("/names?text=zzapi%20fighting%20fish").expect(200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.names[0].canonical_name, "Fakebetta alphaensis");
    await api.get("/names").expect(400);
  });

  void test("PATCH and DELETE /names/:kind/:id edit and remove a Name; 404 missing, 409 on the Canonical name", async () => {
    const names = await catalogue.listNames(betta);
    const common = names.common[0];
    const canonical = names.scientific.find((n) => n.canonical);
    assert.ok(canonical);

    const res = await api
      .patch(`/names/common/${common.name_id}`, { name: "Fakebetta" })
      .expect(200);
    assert.deepEqual(res.body, { kind: "common", name_id: common.name_id, name: "Fakebetta" });
    await api.patch(`/names/common/999999`, { name: "x" }).expect(404);
    await api.patch(`/names/common/${common.name_id}`, {}).expect(400);
    await api.patch(`/names/scientific/${canonical.name_id}`, { name: "Other name" }).expect(409);

    await api.delete(`/names/scientific/${canonical.name_id}`).expect(409);
    await api.delete(`/names/common/${common.name_id}`).expect(204);
    await api.delete(`/names/common/${common.name_id}`).expect(404);
    await api.delete(`/names/vernacular/1`).expect(400);
  });

  void test("POST /names/bulk-remove previews and removes by text or ids; 400 for both, 409 on a Canonical name", async () => {
    await catalogue.addName(guppy, "common", "Zzapi fancy");
    const fancy = await catalogue.addName(betta, "common", "Zzapi fancy");
    const preview = await api
      .post("/names/bulk-remove", { kind: "common", text: "zzapi fancy", preview: true })
      .expect(200);
    assert.equal(preview.body.count, 2);
    assert.equal(preview.body.names.length, 2);

    await api
      .post("/names/bulk-remove", { kind: "common", text: "x", name_ids: [fancy] })
      .expect(400);

    const canonical = (await catalogue.listNames(guppy)).scientific.find((n) => n.canonical);
    assert.ok(canonical);
    await api
      .post("/names/bulk-remove", { kind: "scientific", name_ids: [canonical.name_id] })
      .expect(409);

    const removed = await api
      .post("/names/bulk-remove", { kind: "common", text: "Zzapi fancy" })
      .expect(200);
    assert.equal(removed.body.count, 2);
    assert.equal((await catalogue.findNames("Zzapi fancy")).length, 0);
  });
});

void describe("/api/admin/species IUCN and canonical recommendations", () => {
  void test("IUCN reads return the stats, missing list, stale list and sync log", async () => {
    const stats = await api.get("/iucn/stats").expect(200);
    assert.equal(typeof stats.body.total_syncs, "number");
    const missing = await api.get("/iucn/missing").expect(200);
    const missingIds = missing.body.species.map((s: { group_id: number }) => s.group_id);
    assert.ok(missingIds.includes(betta) && missingIds.includes(guppy));
    const stale = await api.get("/iucn/stale?days_old=30").expect(200);
    assert.equal(stale.body.days_old, 30);
    const log = await api.get(`/iucn/sync-log?group_id=${betta}`).expect(200);
    assert.deepEqual(log.body, { total_count: 0, entries: [] });
    await api.get("/iucn/stale?days_old=soon").expect(400);
  });

  void test("POST /iucn/sync previews its targets; 400 without exactly one selector, 404 for a missing Species", async () => {
    const preview = await api
      .post("/iucn/sync", { missing: true, preview: true, limit: 1 })
      .expect(200);
    assert.equal(preview.body.preview, true);
    assert.equal(preview.body.total_count, 1);
    const byId = await api.post("/iucn/sync", { group_ids: [guppy], preview: true }).expect(200);
    assert.deepEqual(byId.body.species, [
      { group_id: guppy, canonical_name: "Fakepoecilia betaensis" },
    ]);
    await api.post("/iucn/sync", { preview: true }).expect(400);
    await api.post("/iucn/sync", { missing: true, days_old: 3 }).expect(400);
    await api.post("/iucn/sync", { group_ids: [999999], preview: true }).expect(404);
  });

  void test("canonical recommendations list, accept as the token's admin, reject, and 404 once reviewed", async () => {
    const rename = await createCanonicalRecommendation(fixture.db, {
      groupId: betta,
      currentGenus: "Fakebetta",
      currentSpecies: "alphaensis",
      suggestedGenus: "Fakebetta",
      suggestedSpecies: "splendida",
      iucnTaxonId: 1,
      reason: "IUCN name",
    });
    const other = await createCanonicalRecommendation(fixture.db, {
      groupId: guppy,
      currentGenus: "Fakepoecilia",
      currentSpecies: "betaensis",
      suggestedGenus: "Lebistes",
      suggestedSpecies: "reticulatus",
      iucnTaxonId: 2,
      reason: "IUCN name",
    });

    const listed = await api.get("/canonical-recommendations?status=pending").expect(200);
    assert.equal(listed.body.total_count, 2);
    await api.get("/canonical-recommendations?status=maybe").expect(400);

    const accepted = await api.post(`/canonical-recommendations/${rename}/accept`).expect(200);
    assert.deepEqual(accepted.body, {
      recommendation_id: rename,
      status: "accepted",
      reviewed_by: adminId,
    });
    assert.equal((await catalogue.findSpeciesById(betta))?.canonical_species_name, "splendida");
    const reviewed = await fixture.db.get<{ reviewed_by: number }>(
      "SELECT reviewed_by FROM iucn_canonical_recommendations WHERE id = ?",
      rename
    );
    assert.equal(reviewed?.reviewed_by, adminId);
    await api.post(`/canonical-recommendations/${rename}/accept`).expect(404);

    const rejected = await api.post(`/canonical-recommendations/${other}/reject`).expect(200);
    assert.equal(rejected.body.status, "rejected");
    await api.post(`/canonical-recommendations/${other}/reject`).expect(404);
    await api.post(`/canonical-recommendations/${other}/maybe`).expect(400);
  });
});

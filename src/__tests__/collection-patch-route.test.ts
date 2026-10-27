import { afterEach, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import request from "supertest";
import { addToCollection, getCollectionEntry } from "@/db/collection";
import { createMember } from "@/db/members";
import collectionRouter from "@/routes/collection";
import type { MulmRequest } from "@/sessions";
import { createTestDatabase, type TestDatabase } from "./helpers/database";

/**
 * PATCH /api/collection/:id with the body the edit dialog actually posts
 * (collection-edit.pug sends both names, the date, visibility and notes).
 */
void describe("PATCH /api/collection/:id", () => {
  let fixture: TestDatabase;
  let memberId: number;
  let otherId: number;
  let speciesId: number;
  let entryId: number;

  beforeEach(async () => {
    fixture = await createTestDatabase({ foreignKeys: "on", migrations: "latest" });
    memberId = await createMember("patch@example.test", "Patcher");
    otherId = await createMember("other@example.test", "Other");
    const species = await fixture.db.run(`INSERT INTO species_name_group
      (program_class, species_type, canonical_genus, canonical_species_name)
      VALUES ('Livebearers', 'Fish', 'Patchus', 'testus')`);
    speciesId = species.lastID!;
    await fixture.db.run(
      "INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)",
      speciesId,
      "Patch Fish"
    );
    entryId = await addToCollection(memberId, {
      group_id: speciesId,
      acquired_date: "2020-01-01",
      notes: "Old notes",
    });
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  function appAs(id: number | undefined) {
    const app = express();
    app.set("views", path.join(__dirname, "../views"));
    app.set("view engine", "pug");
    app.use(express.urlencoded({ extended: false }));
    app.use((req: MulmRequest, _res, next) => {
      req.viewer = id
        ? { id, display_name: "Viewer", contact_email: "viewer@example.test" }
        : undefined;
      next();
    });
    app.use(collectionRouter);
    return app;
  }

  /** The fields collection-edit.pug renders, pre-filled from the shown entry. */
  async function dialogBody(overrides: Record<string, string> = {}) {
    const shown = await getCollectionEntry(entryId, memberId);
    assert.ok(shown);
    return {
      common_name: shown.common_name ?? "",
      scientific_name: shown.scientific_name ?? "",
      acquired_date: shown.acquired_date ?? "",
      visibility: shown.visibility,
      notes: shown.notes ?? "",
      ...overrides,
    };
  }

  const row = () =>
    fixture.db.get<{ group_id: number | null; notes: string; common_name: string | null }>(
      "SELECT * FROM species_collection WHERE id = ?",
      entryId
    );

  void test("saving the edit dialog with only notes changed keeps a linked entry linked", async () => {
    const body = await dialogBody({ notes: "New notes" });
    assert.equal(body.common_name, "Patch Fish");
    assert.equal(body.scientific_name, "Patchus testus");

    const res = await request(appAs(memberId))
      .patch(`/api/collection/${entryId}`)
      .type("form")
      .send(body);

    assert.equal(res.status, 200);
    assert.match(res.text, /Collection entry updated/);
    const after = await row();
    assert.equal(after?.group_id, speciesId);
    assert.equal(after?.notes, "New notes");
    assert.equal(after?.common_name, null);
  });

  void test("changing a shown name in the dialog converts the entry to a custom one", async () => {
    const res = await request(appAs(memberId))
      .patch(`/api/collection/${entryId}`)
      .type("form")
      .send(await dialogBody({ common_name: "My guppy" }));

    assert.equal(res.status, 200);
    const after = await row();
    assert.equal(after?.group_id, null);
    assert.equal(after?.common_name, "My guppy");
  });

  void test("reads the collection entry once per save", async () => {
    const body = await dialogBody({ notes: "Counted" });
    const reads: string[] = [];
    const record = (sql: unknown) => {
      if (typeof sql === "string" && /^\s*SELECT[\s\S]*FROM\s+species_collection\b/i.test(sql))
        reads.push(sql);
    };
    for (const method of ["prepare", "get", "all"] as const) {
      const original = fixture.db[method].bind(fixture.db) as (...args: unknown[]) => unknown;
      mock.method(fixture.db, method, (...args: unknown[]) => {
        record(args[0]);
        return original(...args);
      });
    }

    try {
      const res = await request(appAs(memberId))
        .patch(`/api/collection/${entryId}`)
        .type("form")
        .send(body);
      assert.equal(res.status, 200);
    } finally {
      mock.restoreAll();
    }

    // The duplicate-current check (only when restoring) is not an entry read.
    assert.equal(reads.length, 1, reads.join("\n---\n"));
    assert.equal((await row())?.notes, "Counted");
  });

  void test("refuses anonymous and foreign members without changing the entry", async () => {
    const before = await row();
    const body = await dialogBody({ notes: "Hijacked" });

    const anonymous = await request(appAs(undefined))
      .patch(`/api/collection/${entryId}`)
      .type("form")
      .send(body);
    assert.equal(anonymous.status, 401);

    for (const visibility of ["public", "private"]) {
      await fixture.db.run("UPDATE species_collection SET visibility = ? WHERE id = ?", visibility, entryId);
      const foreign = await request(appAs(otherId))
        .patch(`/api/collection/${entryId}`)
        .type("form")
        .send(body);
      assert.equal(foreign.status, 403);
      assert.match(foreign.text, /You can only edit your own collection entries/);
    }

    const missing = await request(appAs(memberId))
      .patch("/api/collection/999999")
      .type("form")
      .send(body);
    assert.equal(missing.status, 403);

    assert.equal((await row())?.notes, before?.notes);
  });
});

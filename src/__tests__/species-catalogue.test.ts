/**
 * The Species catalogue, through its interface, over in-memory SQLite with the
 * real migrations. These rows cover what the catalogue promises that the old
 * species data module did not: a rename keeps the old Canonical name findable,
 * a merge keeps the loser's, delete refuses while anything references the
 * Species, and a Point class is one of the tally keys or nothing.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { overrideConnection } from "../db/conn";
import { createMember } from "../db/members";
import {
  createSpecies,
  findSpeciesById,
  findSpeciesByName,
  findSpeciesByCanonicalName,
  resolveSpecies,
  listNames,
  addName,
  removeName,
  renameCanonical,
  mergeSpecies,
  deleteSpecies,
  updateSpecies,
  setPointClass,
  checkFormAgreement,
  listSubmissionsOfSpecies,
  isPointClass,
  CatalogueRefusal,
} from "@/species";

let db: Database;
let memberId: number;

async function speciesWith(opts: {
  genus: string;
  epithet: string;
  common?: string[];
  scientific?: string[];
  pointClass?: 5 | 10 | 15 | 20 | null;
}): Promise<number> {
  const id = await createSpecies({
    canonicalGenus: opts.genus,
    canonicalSpeciesName: opts.epithet,
    programClass: "Livebearers",
    speciesType: "Fish",
    pointClass: opts.pointClass ?? null,
  });
  for (const name of opts.common ?? []) await addName(id, "common", name);
  for (const name of opts.scientific ?? []) await addName(id, "scientific", name);
  return id;
}

/** A Submission referencing one of the Species' Names, as approval leaves it today. */
async function submissionOn(
  speciesId: number,
  opts: { approved?: boolean; points?: number; via?: "common" | "scientific" } = {}
): Promise<number> {
  const names = await listNames(speciesId);
  const via = opts.via ?? "common";
  const name = via === "common" ? names.common[0] : names.scientific[0];
  const now = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO submissions (
      member_id, program, species_type, species_class, species_common_name, species_latin_name,
      reproduction_date, submitted_on, approved_on, points,
      common_name_id, scientific_name_id
    ) VALUES (?, 'fish', 'Fish', 'Livebearers', 'as typed', 'as typed', ?, ?, ?, ?, ?, ?)`,
    [
      memberId,
      now,
      now,
      opts.approved ? now : null,
      opts.approved ? (opts.points ?? 10) : null,
      via === "common" ? name.name_id : null,
      via === "scientific" ? name.name_id : null,
    ]
  );
  return result.lastID as number;
}

void describe("Species catalogue", () => {
  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
    memberId = await createMember("catalogue-member@test.com", "Catalogue Member");
  });

  afterEach(async () => {
    await db.close();
  });

  void describe("lookup", () => {
    void test("finds a Species by a scientific Name only", async () => {
      const id = await speciesWith({
        genus: "Zorbia",
        epithet: "novella",
        scientific: ["Oldgenus novella"],
      });

      const byName = await findSpeciesByName("oldgenus NOVELLA");
      assert.deepStrictEqual(
        byName.map((s) => s.group_id),
        [id]
      );
      assert.strictEqual((await resolveSpecies({ latinName: "Oldgenus novella" }))?.species.group_id, id);
    });

    void test("finds a Species by a common Name only", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "communis", common: ["Zorbish Tetra"] });

      assert.deepStrictEqual(
        (await findSpeciesByName("zorbish tetra", "common")).map((s) => s.group_id),
        [id]
      );
      assert.deepStrictEqual(await findSpeciesByName("zorbish tetra", "scientific"), []);
      const resolved = await resolveSpecies({ commonName: "Zorbish Tetra" });
      assert.strictEqual(resolved?.species.group_id, id);
      assert.strictEqual(resolved?.matchedBy, "common");
    });

    void test("finds a Species by Canonical name, even when it is not among its Names", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "canonica" });

      assert.strictEqual((await findSpeciesByCanonicalName("zorbia Canonica"))?.group_id, id);
      const resolved = await resolveSpecies({ latinName: "Zorbia canonica" });
      assert.strictEqual(resolved?.species.group_id, id);
      assert.strictEqual(resolved?.matchedBy, "canonical");
    });

    void test("prefers the Latin spelling over the common one", async () => {
      const byLatin = await speciesWith({
        genus: "Zorbia",
        epithet: "prima",
        scientific: ["Zorbia prima"],
      });
      await speciesWith({ genus: "Zorbia", epithet: "secunda", common: ["Shared Zorb"] });

      const resolved = await resolveSpecies({ commonName: "Shared Zorb", latinName: "Zorbia prima" });
      assert.strictEqual(resolved?.species.group_id, byLatin);
      assert.strictEqual(resolved?.matchedBy, "scientific");
    });

    void test("finds nothing for an unknown spelling, and nothing for an unknown id", async () => {
      assert.strictEqual(await resolveSpecies({ commonName: "No Such Fish", latinName: "Nulla nulla" }), null);
      assert.strictEqual(await resolveSpecies({}), null);
      assert.strictEqual(await findSpeciesById(987654), undefined);
    });
  });

  void describe("Names", () => {
    void test("add and remove take a kind; the other kind is untouched", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "nominata" });
      const common = await addName(id, "common", "  Zorb  ");
      const scientific = await addName(id, "scientific", "Zorb zorb");

      let names = await listNames(id);
      assert.deepStrictEqual(
        names.common.map((n) => n.name),
        ["Zorb"]
      );
      assert.deepStrictEqual(
        names.scientific.map((n) => n.name),
        ["Zorb zorb"]
      );

      assert.strictEqual(await removeName("common", common), 1);
      names = await listNames(id);
      assert.deepStrictEqual(names.common, []);
      assert.strictEqual(names.scientific[0].name_id, scientific);
    });

    void test("a duplicate Name of the same kind is refused", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "duplex", common: ["Zorb"] });
      await assert.rejects(() => addName(id, "common", "Zorb"), /already exists/);
    });
  });

  void describe("renameCanonical", () => {
    void test("keeps the old Canonical name findable as a scientific Name and adds no common Name", async () => {
      const id = await speciesWith({ genus: "Oldus", epithet: "fishus", common: ["Old Fish"] });

      await renameCanonical(id, "Newus", "fishus");

      const species = await findSpeciesById(id);
      assert.strictEqual(species?.canonical_genus, "Newus");
      const names = await listNames(id);
      assert.deepStrictEqual(
        names.scientific.map((n) => n.name),
        ["Oldus fishus"]
      );
      assert.deepStrictEqual(
        names.common.map((n) => n.name),
        ["Old Fish"]
      );
      assert.strictEqual((await resolveSpecies({ latinName: "Oldus fishus" }))?.species.group_id, id);
      assert.deepStrictEqual(await findSpeciesByName("Oldus fishus", "common"), []);
    });

    void test("does not duplicate an old Canonical name that is already a scientific Name", async () => {
      const id = await speciesWith({ genus: "Oldus", epithet: "twiceus", scientific: ["Oldus twiceus"] });

      await renameCanonical(id, "Newus", "twiceus");

      const names = await listNames(id);
      assert.deepStrictEqual(
        names.scientific.map((n) => n.name),
        ["Oldus twiceus"]
      );
    });

    void test("refuses a Canonical name another Species already has", async () => {
      await speciesWith({ genus: "Takenus", epithet: "already" });
      const id = await speciesWith({ genus: "Freeus", epithet: "already" });

      await assert.rejects(() => renameCanonical(id, "Takenus", "already"), /already exists/);
      assert.strictEqual((await findSpeciesById(id))?.canonical_genus, "Freeus");
      assert.deepStrictEqual((await listNames(id)).scientific, []);
    });

    void test("renaming to the same Canonical name changes nothing", async () => {
      const id = await speciesWith({ genus: "Sameus", epithet: "sameus" });
      await renameCanonical(id, "Sameus", "sameus");
      assert.deepStrictEqual((await listNames(id)).scientific, []);
    });
  });

  void describe("mergeSpecies", () => {
    void test("keeps the loser's Canonical name on the winner as a scientific Name", async () => {
      const winner = await speciesWith({ genus: "Winnerus", epithet: "maximus", common: ["Winner"] });
      const loser = await speciesWith({ genus: "Loserus", epithet: "maximus", common: ["Loser"] });

      await mergeSpecies(winner, loser);

      assert.strictEqual(await findSpeciesById(loser), undefined);
      const names = await listNames(winner);
      assert.deepStrictEqual(
        names.scientific.map((n) => n.name),
        ["Loserus maximus"]
      );
      assert.deepStrictEqual(
        names.common.map((n) => n.name),
        ["Loser", "Winner"]
      );
      assert.strictEqual((await resolveSpecies({ latinName: "Loserus maximus" }))?.species.group_id, winner);
    });

    void test("preserves approved Submissions and their Points", async () => {
      const winner = await speciesWith({ genus: "Winnerus", epithet: "pointus", common: ["Pointy"] });
      const loser = await speciesWith({
        genus: "Loserus",
        epithet: "pointus",
        common: ["Pointy", "Other Pointy"],
        scientific: ["Loserus pointus"],
      });
      const viaDuplicateName = await submissionOn(loser, { approved: true, points: 15 });
      const viaScientific = await submissionOn(loser, { approved: true, points: 20, via: "scientific" });
      const pending = await submissionOn(loser);

      await mergeSpecies(winner, loser);

      const ofWinner = await listSubmissionsOfSpecies(winner);
      assert.deepStrictEqual(
        ofWinner.map((s) => s.id).sort(),
        [viaDuplicateName, viaScientific, pending].sort()
      );
      const byId = new Map(ofWinner.map((s) => [s.id, s]));
      assert.strictEqual(byId.get(viaDuplicateName)?.points, 15);
      assert.strictEqual(byId.get(viaScientific)?.points, 20);
      assert.ok(byId.get(viaDuplicateName)?.approved_on);
      assert.strictEqual(byId.get(pending)?.approved_on, null);
    });

    void test("refuses to merge a Species into itself or into a missing one", async () => {
      const id = await speciesWith({ genus: "Selfus", epithet: "selfus" });
      await assert.rejects(() => mergeSpecies(id, id), CatalogueRefusal);
      await assert.rejects(() => mergeSpecies(id, 987654), /not found/);
    });
  });

  void describe("deleteSpecies", () => {
    void test("deletes an unreferenced Species and its Names", async () => {
      const id = await speciesWith({ genus: "Goneus", epithet: "goneus", common: ["Gone"] });
      assert.strictEqual(await deleteSpecies(id), 1);
      assert.strictEqual(await findSpeciesById(id), undefined);
      assert.deepStrictEqual(await findSpeciesByName("Gone"), []);
    });

    void test("is refused when an approved Submission references the Species", async () => {
      const id = await speciesWith({ genus: "Keptus", epithet: "approvus", common: ["Kept"] });
      await submissionOn(id, { approved: true });
      await assert.rejects(() => deleteSpecies(id), CatalogueRefusal);
      assert.ok(await findSpeciesById(id));
    });

    void test("is refused when an unapproved Submission references the Species", async () => {
      const id = await speciesWith({ genus: "Keptus", epithet: "pendus", scientific: ["Keptus pendus"] });
      await submissionOn(id, { via: "scientific" });
      await assert.rejects(() => deleteSpecies(id), /merge/i);
      assert.ok(await findSpeciesById(id));
    });

    void test("refuses a missing Species", async () => {
      await assert.rejects(() => deleteSpecies(987654), /not found/);
    });
  });

  void describe("Point class", () => {
    void test("is 5, 10, 15, 20 or unset", () => {
      for (const ok of [5, 10, 15, 20]) assert.ok(isPointClass(ok));
      for (const bad of [0, 7, 100, -5, 12.5]) assert.ok(!isPointClass(bad));
    });

    for (const bad of [0, 7, 100]) {
      void test(`refuses ${bad} on create, update and bulk set`, async () => {
        await assert.rejects(
          () =>
            createSpecies({
              canonicalGenus: "Badus",
              canonicalSpeciesName: `pointus${bad}`,
              programClass: "Livebearers",
              speciesType: "Fish",
              pointClass: bad,
            }),
          CatalogueRefusal
        );
        const id = await speciesWith({ genus: "Goodus", epithet: "pointus", pointClass: 10 });
        await assert.rejects(() => updateSpecies(id, { pointClass: bad }), CatalogueRefusal);
        await assert.rejects(() => setPointClass([id], bad), CatalogueRefusal);
        assert.strictEqual((await findSpeciesById(id))?.base_points, 10);
      });
    }

    void test("accepts a tally key and unset", async () => {
      const id = await speciesWith({ genus: "Goodus", epithet: "setus" });
      await updateSpecies(id, { pointClass: 15 });
      assert.strictEqual((await findSpeciesById(id))?.base_points, 15);
      assert.strictEqual(await setPointClass([id], null), 1);
      assert.strictEqual((await findSpeciesById(id))?.base_points, null);
    });
  });

  void describe("checkFormAgreement", () => {
    void test("agrees when spellings are Names and classification matches", async () => {
      const id = await speciesWith({
        genus: "Agreeus",
        epithet: "agreeus",
        common: ["Agree Fish"],
        scientific: ["Olderus agreeus"],
      });

      const agreement = await checkFormAgreement(id, {
        species_common_name: "agree fish",
        species_latin_name: "Agreeus agreeus",
        species_type: "Fish",
        species_class: "Livebearers",
      });
      assert.deepStrictEqual(agreement, {
        agrees: true,
        spellingsAgree: true,
        classificationAgrees: true,
        commonName: "name",
        latinName: "name",
        speciesType: true,
        programClass: true,
      });
    });

    void test("reports a spelling that is not a Name, and a classification mismatch", async () => {
      const id = await speciesWith({ genus: "Agreeus", epithet: "notus", common: ["Agree Fish"] });

      const agreement = await checkFormAgreement(id, {
        species_common_name: "Agree Fsh",
        species_latin_name: "Agree Fish",
        species_type: "Fish",
        species_class: "Cichlids",
      });
      assert.strictEqual(agreement?.agrees, false);
      assert.strictEqual(agreement?.commonName, "not-a-name");
      assert.strictEqual(agreement?.latinName, "not-a-name", "a common Name is not a Latin spelling");
      assert.strictEqual(agreement?.speciesType, true);
      assert.strictEqual(agreement?.programClass, false);
    });

    void test("is undefined for a missing Species", async () => {
      assert.strictEqual(await checkFormAgreement(987654, {}), undefined);
    });
  });
});

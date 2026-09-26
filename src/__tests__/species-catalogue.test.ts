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
  countSubmissionsOfSpecies,
  isPointClass,
  CatalogueRefusal,
  findSpeciesByIds,
  listSpeciesDueIucnSync,
  updateName,
  getSpeciesStatistics,
  previewMerge,
  findNames,
  canonicalName,
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

/** A Submission bound to the Species, as approval leaves it. */
async function submissionOn(
  speciesId: number,
  opts: { approved?: boolean; points?: number } = {}
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO submissions (
      member_id, program, species_type, species_class, species_common_name, species_latin_name,
      reproduction_date, submitted_on, approved_on, points, species_id
    ) VALUES (?, 'fish', 'Fish', 'Livebearers', 'as typed', 'as typed', ?, ?, ?, ?, ?)`,
    [
      memberId,
      now,
      now,
      opts.approved ? now : null,
      opts.approved ? (opts.points ?? 10) : null,
      speciesId,
    ]
  );
  return result.lastID as number;
}

/** The Species a Submission is bound to, or null. */
async function speciesOfSubmission(submissionId: number): Promise<number | null> {
  const row = await db.get<{ species_id: number | null }>(
    "SELECT species_id FROM submissions WHERE id = ?",
    [submissionId]
  );
  return row?.species_id ?? null;
}

/**
 * ADR-0002's invariant: exactly one scientific Name of the Species is flagged
 * as its Canonical name, and its text is the cached genus and epithet.
 */
async function assertOneCanonicalName(speciesId: number) {
  const species = await findSpeciesById(speciesId);
  assert.ok(species, `Species ${speciesId} exists`);
  const names = await listNames(speciesId);
  assert.deepStrictEqual(
    names.scientific.filter((n) => n.canonical).map((n) => n.name),
    [canonicalName(species)],
    `Species ${speciesId} has exactly one flagged Name, equal to its cache`
  );
  assert.ok(!names.common.some((n) => n.canonical), "no common Name is canonical");
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

      assert.deepStrictEqual(
        (await findNames("oldgenus NOVELLA")).map((n) => n.species_id),
        [id]
      );
      assert.strictEqual((await resolveSpecies({ latinName: "Oldgenus novella" }))?.species.group_id, id);
    });

    void test("finds a Species by a common Name only", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "communis", common: ["Zorbish Tetra"] });

      assert.deepStrictEqual(
        (await findNames("zorbish tetra", "common")).map((n) => n.species_id),
        [id]
      );
      assert.deepStrictEqual(await findNames("zorbish tetra", "scientific"), []);
      const resolved = await resolveSpecies({ commonName: "Zorbish Tetra" });
      assert.strictEqual(resolved?.species.group_id, id);
      assert.strictEqual(resolved?.matchedBy, "common");
    });

    void test("finds a Species by its Canonical name, which is one of its scientific Names", async () => {
      const id = await speciesWith({ genus: "Zorbia", epithet: "canonica" });

      const resolved = await resolveSpecies({ latinName: "zorbia Canonica" });
      assert.strictEqual(resolved?.species.group_id, id);
      assert.strictEqual(resolved?.matchedBy, "scientific");
    });

    void test("prefers the Species whose Canonical name it is over one that keeps it as an old Name", async () => {
      const keeper = await speciesWith({ genus: "Aaaolder", epithet: "splitus", scientific: ["Zorbia splitus"] });
      const holder = await speciesWith({ genus: "Zorbia", epithet: "splitus" });

      assert.strictEqual((await resolveSpecies({ latinName: "Zorbia splitus" }))?.species.group_id, holder);
      assert.notStrictEqual(keeper, holder);
    });

    void test("finds a Canonical name typed with doubled spaces", async () => {
      const id = await speciesWith({ genus: "Spacius", epithet: "aeneus venezuelan" });
      assert.strictEqual(
        (await resolveSpecies({ latinName: " Spacius  aeneus   venezuelan " }))?.species.group_id,
        id
      );
    });

    void test("a Latin spelling that is a Canonical name wins over a common spelling of another Species", async () => {
      const byCanonical = await speciesWith({ genus: "Zorbia", epithet: "latina" });
      await speciesWith({ genus: "Zorbia", epithet: "vulgaris", common: ["Common Zorb"] });

      const resolved = await resolveSpecies({ commonName: "Common Zorb", latinName: "Zorbia latina" });
      assert.strictEqual(resolved?.species.group_id, byCanonical);
    });

    void test("prefers the Latin spelling over the common one", async () => {
      const byLatin = await speciesWith({ genus: "Zorbia", epithet: "prima" });
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
        ["Zorb zorb", "Zorbia nominata"]
      );

      assert.strictEqual(await removeName("common", common), 1);
      names = await listNames(id);
      assert.deepStrictEqual(names.common, []);
      assert.strictEqual(names.scientific[0].name_id, scientific);
    });

    void test("updateName corrects the text in place, keeping the id", async () => {
      const id = await speciesWith({ genus: "Typous", epithet: "typous", common: ["Typo Fsh"] });
      const [typo] = (await listNames(id)).common;
      const submission = await submissionOn(id);

      assert.strictEqual(await updateName("common", typo.name_id, " Typo Fish "), 1);

      assert.deepStrictEqual(
        (await listNames(id)).common.map((n) => [n.name_id, n.name]),
        [[typo.name_id, "Typo Fish"]]
      );
      assert.strictEqual(await speciesOfSubmission(submission), id);
      assert.strictEqual(await updateName("common", 987654, "Nothing"), 0);
    });

    void test("updateName refuses empty text and a Name the Species already has", async () => {
      const id = await speciesWith({ genus: "Typous", epithet: "twice", common: ["One", "Two"] });
      const [one] = (await listNames(id)).common;
      await assert.rejects(() => updateName("common", one.name_id, "  "), CatalogueRefusal);
      await assert.rejects(() => updateName("common", one.name_id, "Two"), /already exists/);
    });

    void test("removeName takes several ids of one kind at once", async () => {
      const id = await speciesWith({ genus: "Bulkus", epithet: "bulkus", common: ["A", "B", "C"] });
      const [a, b] = (await listNames(id)).common;
      assert.strictEqual(await removeName("common", [a.name_id, b.name_id, 987654]), 2);
      assert.deepStrictEqual(
        (await listNames(id)).common.map((n) => n.name),
        ["C"]
      );
      assert.strictEqual(await removeName("common", []), 0);
    });

    void test("findNames finds every Name with a text across Species, by kind", async () => {
      const a = await speciesWith({ genus: "Findus", epithet: "one", common: ["Lookalike"] });
      const b = await speciesWith({ genus: "Findus", epithet: "two", scientific: ["lookalike"] });

      assert.deepStrictEqual(
        (await findNames(" LOOKALIKE ")).map((n) => [n.kind, n.species_id]),
        [
          ["common", a],
          ["scientific", b],
        ]
      );
      assert.deepStrictEqual(
        (await findNames("lookalike", "scientific")).map((n) => n.species_id),
        [b]
      );
      assert.deepStrictEqual(await findNames("  "), []);
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
        names.scientific.map((n) => [n.name, n.canonical]),
        [
          ["Newus fishus", true],
          ["Oldus fishus", false],
        ]
      );
      assert.deepStrictEqual(
        names.common.map((n) => n.name),
        ["Old Fish"]
      );
      assert.strictEqual((await resolveSpecies({ latinName: "Oldus fishus" }))?.species.group_id, id);
      assert.deepStrictEqual(await findNames("Oldus fishus", "common"), []);
    });

    void test("keeps the old Canonical name's row and id, so its Submissions keep it", async () => {
      const id = await speciesWith({ genus: "Oldus", epithet: "twiceus" });
      const [old] = (await listNames(id)).scientific;
      const submission = await submissionOn(id);

      await renameCanonical(id, "Newus", "twiceus");

      const names = await listNames(id);
      assert.deepStrictEqual(
        names.scientific.map((n) => [n.name_id === old.name_id, n.name, n.canonical]),
        [
          [false, "Newus twiceus", true],
          [true, "Oldus twiceus", false],
        ]
      );
      assert.strictEqual(await speciesOfSubmission(submission), id);
    });

    void test("refuses a Canonical name another Species already has", async () => {
      await speciesWith({ genus: "Takenus", epithet: "already" });
      const id = await speciesWith({ genus: "Freeus", epithet: "already" });

      await assert.rejects(() => renameCanonical(id, "Takenus", "already"), /already exists/);
      assert.strictEqual((await findSpeciesById(id))?.canonical_genus, "Freeus");
      assert.deepStrictEqual(
        (await listNames(id)).scientific.map((n) => [n.name, n.canonical]),
        [["Freeus already", true]]
      );
    });

    void test("renaming to the same Canonical name changes nothing", async () => {
      const id = await speciesWith({ genus: "Sameus", epithet: "sameus" });
      const before = await listNames(id);
      await renameCanonical(id, "Sameus", "sameus");
      assert.deepStrictEqual(await listNames(id), before);
    });
  });

  void describe("the Canonical name is a flagged scientific Name", () => {
    void test("create adds it", async () => {
      const id = await speciesWith({ genus: "Createus", epithet: "aeneus venezuelan" });
      await assertOneCanonicalName(id);
      assert.deepStrictEqual(
        (await findNames("createus AENEUS venezuelan")).map((n) => [n.species_id, n.kind, n.canonical]),
        [[id, "scientific", true]]
      );
    });

    void test("rename moves it; each step leaves one flagged Name matching the cache", async () => {
      const id = await speciesWith({
        genus: "Firstus",
        epithet: "movus",
        scientific: ["Thirdus movus", "fourthus movus"],
      });
      const idOf = async (text: string) =>
        (await listNames(id)).scientific.find((n) => n.name === text)?.name_id;
      const third = await idOf("Thirdus movus");
      const fourth = await idOf("fourthus movus");

      // To a new name: added and flagged; the old stays, unflagged.
      await renameCanonical(id, "Secondus", "movus");
      await assertOneCanonicalName(id);

      // To a Name the Species already has: that row is flagged, not duplicated.
      await renameCanonical(id, "Thirdus", "movus");
      await assertOneCanonicalName(id);
      assert.strictEqual(await idOf("Thirdus movus"), third);

      // To a Name it has in another case: that row is flagged and its spelling corrected.
      await renameCanonical(id, "Fourthus", "movus");
      await assertOneCanonicalName(id);
      assert.strictEqual(await idOf("Fourthus movus"), fourth);

      // A change of case only: corrected in place, keeping its id, and no old spelling is kept.
      await renameCanonical(id, "Fourthus", "Movus");
      await assertOneCanonicalName(id);
      assert.strictEqual(await idOf("Fourthus Movus"), fourth);

      assert.deepStrictEqual(
        (await listNames(id)).scientific.map((n) => [n.name, n.canonical]),
        [
          ["Firstus movus", false],
          ["Fourthus Movus", true],
          ["Secondus movus", false],
          ["Thirdus movus", false],
        ]
      );
      assert.deepStrictEqual((await listNames(id)).common, []);
    });

    void test("a change of case to a spelling the Species already has folds the old one into it", async () => {
      const id = await speciesWith({ genus: "Foldus", epithet: "Casus", scientific: ["Foldus casus"] });
      const submission = await submissionOn(id);

      await renameCanonical(id, "Foldus", "casus");

      await assertOneCanonicalName(id);
      const names = (await listNames(id)).scientific;
      assert.deepStrictEqual(
        names.map((n) => n.name),
        ["Foldus casus"]
      );
      assert.strictEqual(await speciesOfSubmission(submission), id);
    });

    void test("merge: the winner keeps its flag and the loser's comes along unflagged", async () => {
      const winner = await speciesWith({ genus: "Winnerus", epithet: "flagus" });
      const loser = await speciesWith({ genus: "Loserus", epithet: "flagus", scientific: ["Olderus flagus"] });

      await mergeSpecies(winner, loser);

      await assertOneCanonicalName(winner);
      assert.deepStrictEqual(
        (await listNames(winner)).scientific.map((n) => [n.name, n.canonical]),
        [
          ["Loserus flagus", false],
          ["Olderus flagus", false],
          ["Winnerus flagus", true],
        ]
      );
    });

    void test("merge folds a loser's Canonical name the winner already has, in any case", async () => {
      const winner = await speciesWith({ genus: "Winnerus", epithet: "foldus", scientific: ["loserus foldus"] });
      const loser = await speciesWith({ genus: "Loserus", epithet: "foldus" });
      const submission = await submissionOn(loser, { approved: true, points: 15 });

      assert.strictEqual((await previewMerge(winner, loser)).keepsLoserCanonicalName, false);
      await mergeSpecies(winner, loser);

      await assertOneCanonicalName(winner);
      assert.deepStrictEqual(
        (await listNames(winner)).scientific.map((n) => [n.name, n.canonical]),
        [
          ["Winnerus foldus", true],
          ["loserus foldus", false],
        ]
      );
      assert.strictEqual(await speciesOfSubmission(submission), winner);
    });

    void test("removeName refuses it, alone or in a batch, and removes nothing", async () => {
      const id = await speciesWith({ genus: "Guardus", epithet: "removus", scientific: ["Olderus removus"] });
      const names = (await listNames(id)).scientific;
      const canonical = names.find((n) => n.canonical)!;
      const other = names.find((n) => !n.canonical)!;

      await assert.rejects(
        () => removeName("scientific", canonical.name_id),
        (err: unknown) => err instanceof CatalogueRefusal && err.code === "canonical"
      );
      await assert.rejects(() => removeName("scientific", [other.name_id, canonical.name_id]), CatalogueRefusal);
      assert.strictEqual((await listNames(id)).scientific.length, 2);
      await assertOneCanonicalName(id);

      assert.strictEqual(await removeName("scientific", other.name_id), 1);
    });

    void test("updateName refuses it; renameCanonical is the way to change it", async () => {
      const id = await speciesWith({ genus: "Guardus", epithet: "updatus", scientific: ["Olderus updatus"] });
      const names = (await listNames(id)).scientific;
      const canonical = names.find((n) => n.canonical)!;
      const other = names.find((n) => !n.canonical)!;

      await assert.rejects(
        () => updateName("scientific", canonical.name_id, "Guardus Updatus"),
        (err: unknown) => err instanceof CatalogueRefusal && err.code === "canonical"
      );
      await assertOneCanonicalName(id);
      assert.strictEqual(await updateName("scientific", other.name_id, "Oldestus updatus"), 1);
    });

    void test("adding it again as a Name is refused as a duplicate", async () => {
      const id = await speciesWith({ genus: "Twiceus", epithet: "addus" });
      await assert.rejects(() => addName(id, "scientific", "Twiceus addus"), /already exists/);
    });

    void test("the database refuses a second flagged Name for a Species", async () => {
      const id = await speciesWith({ genus: "Indexus", epithet: "secondus" });
      await assert.rejects(
        () =>
          db.run(
            "INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical) VALUES (?, 'Otherus secondus', 1)",
            [id]
          ),
        /UNIQUE constraint/
      );
      await assertOneCanonicalName(id);
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
        names.scientific.map((n) => [n.name, n.canonical]),
        [
          ["Loserus maximus", false],
          ["Winnerus maximus", true],
        ]
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
      });
      const approved15 = await submissionOn(loser, { approved: true, points: 15 });
      const approved20 = await submissionOn(loser, { approved: true, points: 20 });
      const pending = await submissionOn(loser);

      await mergeSpecies(winner, loser);

      for (const id of [approved15, approved20, pending]) {
        assert.strictEqual(await speciesOfSubmission(id), winner);
      }
      assert.deepStrictEqual(await countSubmissionsOfSpecies(winner), { total: 3, approved: 2 });
      const row = (id: number) =>
        db.get<{ points: number | null; approved_on: string | null }>(
          "SELECT points, approved_on FROM submissions WHERE id = ?",
          [id]
        );
      assert.strictEqual((await row(approved15))?.points, 15);
      assert.strictEqual((await row(approved20))?.points, 20);
      assert.ok((await row(approved15))?.approved_on);
      assert.strictEqual((await row(pending))?.approved_on, null);
    });

    void test("previewMerge says what mergeSpecies will do, and changes nothing", async () => {
      const winner = await speciesWith({
        genus: "Winnerus",
        epithet: "previewus",
        common: ["Shared"],
      });
      const loser = await speciesWith({
        genus: "Loserus",
        epithet: "previewus",
        common: ["shared", "Only Loser"],
      });
      await submissionOn(loser, { approved: true });

      const plan = await previewMerge(winner, loser);
      assert.deepStrictEqual(plan.moving, { common: ["Only Loser"], scientific: ["Loserus previewus"] });
      assert.deepStrictEqual(plan.folding, { common: ["shared"], scientific: [] });
      assert.strictEqual(plan.keepsLoserCanonicalName, true);
      assert.deepStrictEqual(plan.submissions, { total: 1, approved: 1 });
      assert.ok(await findSpeciesById(loser), "a preview merges nothing");

      await mergeSpecies(winner, loser);
      const names = await listNames(winner);
      assert.deepStrictEqual(
        names.common.map((n) => n.name),
        ["Only Loser", "Shared"]
      );
      assert.deepStrictEqual(
        names.scientific.map((n) => n.name),
        ["Loserus previewus", "Winnerus previewus"]
      );
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
      assert.deepStrictEqual(await findNames("Gone"), []);
    });

    void test("is refused when an approved Submission references the Species", async () => {
      const id = await speciesWith({ genus: "Keptus", epithet: "approvus", common: ["Kept"] });
      await submissionOn(id, { approved: true });
      await assert.rejects(() => deleteSpecies(id), CatalogueRefusal);
      assert.ok(await findSpeciesById(id));
    });

    void test("is refused when an unapproved Submission references the Species", async () => {
      const id = await speciesWith({ genus: "Keptus", epithet: "pendus" });
      await submissionOn(id);
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

  void describe("reads the routes use", () => {
    void test("findSpeciesByIds returns the ones that exist", async () => {
      const a = await speciesWith({ genus: "Aaaus", epithet: "one" });
      const b = await speciesWith({ genus: "Bbbus", epithet: "two" });
      assert.deepStrictEqual(
        (await findSpeciesByIds([b, 987654, a])).map((s) => s.group_id),
        [a, b]
      );
      assert.deepStrictEqual(await findSpeciesByIds([]), []);
    });

    void test("getSpeciesStatistics counts Species, CARES and Point class set or unset", async () => {
      const before = await getSpeciesStatistics();
      await speciesWith({ genus: "Statsus", epithet: "set", pointClass: 10 });
      await speciesWith({ genus: "Statsus", epithet: "unset" });

      const after = await getSpeciesStatistics();
      assert.strictEqual(after.total_species, before.total_species + 2);
      assert.strictEqual(after.with_base_points, before.with_base_points + 1);
      assert.strictEqual(after.without_base_points, before.without_base_points + 1);
      assert.strictEqual(after.by_type.Fish, (before.by_type.Fish ?? 0) + 2);
      assert.strictEqual(after.cares_species, before.cares_species);
    });

    void test("listSpeciesDueIucnSync lists never-synced and stale Species of the type", async () => {
      const never = await speciesWith({ genus: "Iucnus", epithet: "never" });
      const stale = await speciesWith({ genus: "Iucnus", epithet: "stale" });
      const fresh = await speciesWith({ genus: "Iucnus", epithet: "fresh" });
      await db.run("UPDATE species_name_group SET iucn_last_updated = '2020-01-01' WHERE group_id = ?", [stale]);
      await db.run("UPDATE species_name_group SET iucn_last_updated = '2099-01-01' WHERE group_id = ?", [fresh]);

      const due = (await listSpeciesDueIucnSync("Fish", new Date("2030-01-01"), 5000)).map((s) => s.group_id);
      assert.ok(due.includes(never));
      assert.ok(due.includes(stale));
      assert.ok(!due.includes(fresh));
      assert.ok(due.indexOf(stale) > due.indexOf(never), "never-synced first");
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

    void test("a Species with no common Names goes by its Latin name in the common field", async () => {
      const id = await speciesWith({ genus: "Nocommonus", epithet: "latinus", scientific: ["Oldus latinus"] });

      for (const spelling of ["Nocommonus latinus", "oldus latinus"]) {
        const agreement = await checkFormAgreement(id, {
          species_common_name: spelling,
          species_latin_name: "Nocommonus latinus",
          species_type: "Fish",
          species_class: "Livebearers",
        });
        assert.strictEqual(agreement?.commonName, "name", spelling);
        assert.strictEqual(agreement?.agrees, true, spelling);
      }
    });

    void test("a Species with common Names does not take a Latin name in the common field", async () => {
      const id = await speciesWith({ genus: "Hascommonus", epithet: "latinus", common: ["Has Fish"] });

      const agreement = await checkFormAgreement(id, {
        species_common_name: "Hascommonus latinus",
        species_latin_name: "Hascommonus latinus",
        species_type: "Fish",
        species_class: "Livebearers",
      });
      assert.strictEqual(agreement?.commonName, "not-a-name");
      assert.strictEqual(agreement?.agrees, false);
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

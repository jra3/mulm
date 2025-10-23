import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  getSpeciesForExplorer,
  getSpeciesDetail,
  type SpeciesFilters,
} from "../db/species";
import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestSpeciesName,
  type TestContext,
} from "./helpers/testHelpers";

void describe("Species Explorer Search Functionality", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestDatabase();

    // Create test species using the split schema
    const species1 = await createTestSpeciesName(
      ctx.db,
      "Cockatoo Dwarf Cichlid",
      "Apistogramma cacatuoides",
      "Apistogramma",
      "cacatuoides",
      "Cichlids - New World"
    );

    const species2 = await createTestSpeciesName(
      ctx.db,
      "Neon Tetra",
      "Paracheirodon innesi",
      "Neon",
      "tetra",
      "Characins"
    );

    const species3 = await createTestSpeciesName(
      ctx.db,
      "Fancy Guppy",
      "Poecilia reticulata",
      "Guppy",
      "fancy",
      "Livebearers"
    );

    // Create test submissions to populate species counts
    const submissions = [
      {
        member_id: ctx.member.id,
        common_name_id: species1.common_name_id,
        scientific_name_id: species1.scientific_name_id,
        program: "fish",
        species_type: "Fish",
        species_class: "Cichlids - New World",
        species_common_name: "Cockatoo Dwarf Cichlid",
        species_latin_name: "Apistogramma cacatuoides",
        approved_on: "2024-01-01",
        points: 15,
      },
      {
        member_id: ctx.member.id,
        common_name_id: species2.common_name_id,
        scientific_name_id: species2.scientific_name_id,
        program: "fish",
        species_type: "Fish",
        species_class: "Characins",
        species_common_name: "Neon Tetra",
        species_latin_name: "Paracheirodon innesi",
        approved_on: "2024-01-15",
        points: 10,
      },
      {
        member_id: ctx.admin.id,
        common_name_id: species1.common_name_id,
        scientific_name_id: species1.scientific_name_id,
        program: "fish",
        species_type: "Fish",
        species_class: "Cichlids - New World",
        species_common_name: "Cockatoo Dwarf Cichlid",
        species_latin_name: "Apistogramma cacatuoides",
        approved_on: "2024-02-01",
        points: 15,
      },
      {
        member_id: ctx.admin.id,
        common_name_id: species3.common_name_id,
        scientific_name_id: species3.scientific_name_id,
        program: "fish",
        species_type: "Fish",
        species_class: "Livebearers",
        species_common_name: "Fancy Guppy",
        species_latin_name: "Poecilia reticulata",
        approved_on: "2024-02-15",
        points: 5,
      },
    ];

    for (const submission of submissions) {
      await ctx.db.run(
        `INSERT INTO submissions (
          member_id, common_name_id, scientific_name_id, program, species_type, species_class,
          species_common_name, species_latin_name, approved_on, points
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          submission.member_id,
          submission.common_name_id,
          submission.scientific_name_id,
          submission.program,
          submission.species_type,
          submission.species_class,
          submission.species_common_name,
          submission.species_latin_name,
          submission.approved_on,
          submission.points,
        ]
      );
    }
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("Returns all species with no filters", async () => {
    const species = await getSpeciesForExplorer();
    assert.strictEqual(species.length, 3);
  });

  void test("Filters by species type correctly", async () => {
    const filters: SpeciesFilters = { species_type: "Fish" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 3);

    const filters2: SpeciesFilters = { species_type: "Plant" };
    const species2 = await getSpeciesForExplorer(filters2);
    assert.strictEqual(species2.length, 0);
  });

  void test("Filters by species class correctly", async () => {
    const filters: SpeciesFilters = { species_class: "Cichlids - New World" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
  });

  void test("Search by genus works correctly", async () => {
    const filters: SpeciesFilters = { search: "Apisto" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
  });

  void test("Search by common name works correctly", async () => {
    const filters: SpeciesFilters = { search: "Neon" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Neon");
  });

  void test("Search by scientific name works correctly", async () => {
    const filters: SpeciesFilters = { search: "Paracheirodon" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Neon");
  });

  void test("Case insensitive search works", async () => {
    const filters: SpeciesFilters = { search: "APISTO" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
  });

  void test("Partial name search works", async () => {
    const filters: SpeciesFilters = { search: "caca" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_species_name, "cacatuoides");
  });

  void test("Sorting by name works correctly", async () => {
    const filters: SpeciesFilters = { sort: "name" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 3);
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
    assert.strictEqual(species[1].canonical_genus, "Guppy");
    assert.strictEqual(species[2].canonical_genus, "Neon");
  });

  void test("Sorting by reports works correctly", async () => {
    const filters: SpeciesFilters = { sort: "reports" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 3);
    // Should be ordered by total_breeds DESC - Apistogramma has 2 breeds
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
    assert.strictEqual(species[0].total_breeds, 2);
  });

  void test("Sorting by breeders works correctly", async () => {
    const filters: SpeciesFilters = { sort: "breeders" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 3);
    // Should be ordered by total_breeders DESC - Apistogramma has 2 breeders
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
    assert.strictEqual(species[0].total_breeders, 2);
  });

  void test("Combined filters work correctly", async () => {
    const filters: SpeciesFilters = {
      species_type: "Fish",
      species_class: "Cichlids - New World",
      search: "Apisto",
    };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 1);
    assert.strictEqual(species[0].canonical_genus, "Apistogramma");
  });

  void test("No results when filters match nothing", async () => {
    const filters: SpeciesFilters = { search: "NonExistentSpecies" };
    const species = await getSpeciesForExplorer(filters);
    assert.strictEqual(species.length, 0);
  });

  void test("Species counts are accurate", async () => {
    const species = await getSpeciesForExplorer();
    const apisto = species.find((s) => s.canonical_genus === "Apistogramma");
    const neon = species.find((s) => s.canonical_genus === "Neon");
    const guppy = species.find((s) => s.canonical_genus === "Guppy");

    assert.ok(apisto);
    assert.strictEqual(apisto.total_breeds, 2);
    assert.strictEqual(apisto.total_breeders, 2);

    assert.ok(neon);
    assert.strictEqual(neon.total_breeds, 1);
    assert.strictEqual(neon.total_breeders, 1);

    assert.ok(guppy);
    assert.strictEqual(guppy.total_breeds, 1);
    assert.strictEqual(guppy.total_breeders, 1);
  });
});

void describe("Species Detail Functionality", () => {
  let ctx: TestContext;
  let species1GroupId: number;

  beforeEach(async () => {
    ctx = await setupTestDatabase();

    const species1 = await createTestSpeciesName(
      ctx.db,
      "Cockatoo Dwarf Cichlid",
      "Apistogramma cacatuoides",
      "Apistogramma",
      "cacatuoides",
      "Cichlids - New World"
    );
    species1GroupId = species1.group_id;
  });

  afterEach(async () => {
    await teardownTestDatabase(ctx);
  });

  void test("Returns species detail correctly", async () => {
    const detail = await getSpeciesDetail(species1GroupId);

    assert.ok(detail);
    assert.strictEqual(detail.canonical_genus, "Apistogramma");
    assert.strictEqual(detail.canonical_species_name, "cacatuoides");
    assert.ok(detail.synonyms.length > 0);
  });

  void test("Returns null for non-existent species", async () => {
    const detail = await getSpeciesDetail(99999);
    assert.strictEqual(detail, null);
  });
});

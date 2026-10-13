import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  normalizeDateString,
  normalizeNullLike,
  normalizeWaterType,
  fuzzyMatchList,
  normalizeFoods,
  normalizeSpawnLocations,
  parseFertilizers,
} from "@/backfill/normalization";

void test("historical CSV parsing and normalization need no server, files or configured database", () => {
  const parsed = parseCsv(
    'member_name,species_common_name,foods\n"A, B",Guppy,"Flake and pellets; Flake"\n\n'
  );
  assert.deepEqual(parsed.columns, ["member_name", "species_common_name", "foods"]);
  assert.equal(parsed.rows[0].member_name, "A, B");
  assert.deepEqual(parseCsv(""), { rows: [], columns: [] });
  assert.equal(normalizeDateString("Mid April 2024"), "2024-04-15");
  assert.equal(normalizeDateString("June/July 2024"), "2024-06-15");
  assert.equal(normalizeDateString("June-July 2024"), "2024-06-15");
  assert.equal(normalizeDateString("Sept 2024"), "2024-09-01");
  assert.equal(normalizeDateString("1/2/2024"), "2024-01-02");
  assert.equal(normalizeDateString("2024-04-01"), "2024-04-01");
  assert.equal(normalizeDateString("not a date"), null);
  assert.equal(normalizeDateString(undefined), null);
  // Preserve the historical importer's lexical passthrough, independent of
  // stricter ISO dates required for explicit transport date overrides.
  assert.equal(normalizeDateString("2024-02-30"), "2024-02-30");
  assert.equal(normalizeWaterType("marine"), "Salt");
  assert.equal(normalizeWaterType("freshwater"), "Fresh");
  assert.equal(normalizeWaterType(" custom "), "custom");
  assert.equal(normalizeNullLike(" Don't test "), null);
  assert.equal(normalizeNullLike(" 7.2 "), "7.2");
  assert.deepEqual(fuzzyMatchList("flake and pell; flake, bespoke", ["Flakes", "Pellets"]), [
    "Flakes",
    "Pellets",
    "bespoke",
  ]);
  assert.equal(normalizeFoods(undefined), null);
  assert.equal(normalizeSpawnLocations(""), null);
  assert.deepEqual(JSON.parse(normalizeFoods("unlisted food") ?? "null"), ["unlisted food"]);
  assert.deepEqual(parseFertilizers("Iron; Potassium"), [
    { type: "Iron", regimen: "" },
    { type: "Potassium", regimen: "" },
  ]);
  assert.deepEqual(parseFertilizers("N/A"), []);
});

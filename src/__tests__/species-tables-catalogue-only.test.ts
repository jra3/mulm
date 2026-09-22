/**
 * The Species catalogue (`src/species/`) is the only module whose SQL names
 * the species tables. Everything else reads a Species through the catalogue's
 * functions or composes its SQL fragments (`speciesJoinSql` and friends).
 *
 * This scans the source for SQL that selects from, joins, inserts into,
 * updates or deletes from a species table anywhere else. It matches the
 * table in SQL position (after FROM, JOIN, INTO or UPDATE), so the
 * Submission's own columns (`species_common_name`, `species_latin_name`) do
 * not trip it. It does not see a comma join (`FROM a, species_name_group`)
 * or a table name built at runtime.
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";

const srcRoot = path.join(__dirname, "..");
const allowed = [path.join(srcRoot, "species"), path.join(srcRoot, "__tests__")];

const speciesTables = ["species_name_group", "species_common_name", "species_scientific_name"];
const sqlPosition = new RegExp(
  `\\b(FROM|JOIN|INTO|UPDATE)\\s+(${speciesTables.join("|")})\\b`,
  "gi"
);

function sourceFiles(dir: string): string[] {
  if (allowed.some((a) => dir === a)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

void describe("Species tables", () => {
  void test("no SQL outside the catalogue names a species table", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      // Whole-file match: SQL keywords and table names can sit on different lines
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(sqlPosition)) {
        const line = text.slice(0, match.index).split("\n").length;
        violations.push(`${path.relative(srcRoot, file)}:${line}: ${match[0].replace(/\s+/g, " ")}`);
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `Read the Species through @/species (or compose its SQL fragments); found:\n${violations.join("\n")}`
    );
  });
});

/**
 * Search by "contains": `%` and `_` in what a person types are characters,
 * not wildcards. Email addresses are full of `_`, so member search is where
 * this shows most.
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { overrideConnection } from "../db/conn";
import { containsPattern } from "../db/likePattern";
import { createMember, searchMembers } from "../db/members";

void describe("containsPattern", () => {
  void test("escapes %, _ and the escape character, and lowercases", () => {
    assert.strictEqual(containsPattern("  A_b%C\\d "), "%a\\_b\\%c\\\\d%");
  });
});

void describe("LIKE with a bound parameter", () => {
  // A LIKE against a `?` is a search on input; it goes through containsSql so
  // the input is escaped. LIKE against a literal pattern ('%r2.dev%') is fine.
  void test("is written only by containsSql", () => {
    const srcRoot = path.join(__dirname, "..");
    const sourceFiles = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });
    const helper = path.join(srcRoot, "db", "likePattern.ts");
    const offenders = sourceFiles(srcRoot)
      .filter((file) => file !== helper && /\bLIKE\s+(LOWER\()?\?/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(srcRoot, file));
    assert.deepStrictEqual(offenders, [], "use containsSql/containsPattern from src/db/likePattern.ts");
  });
});

void describe("searchMembers", () => {
  let db: Database;

  beforeEach(async () => {
    db = await open({ filename: ":memory:", driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.migrate({ migrationsPath: "./db/migrations" });
    overrideConnection(db);
    await createMember("jane_doe@example.com", "Jane Doe");
    await createMember("janexdoe@example.com", "Jane X");
    await createMember("pct@example.com", "100% Guppies");
  });

  afterEach(async () => {
    await db.close();
  });

  const emails = async (q: string) => (await searchMembers(q)).map((m) => m.contact_email).sort();

  void test("_ matches only an underscore", async () => {
    assert.deepStrictEqual(await emails("jane_doe"), ["jane_doe@example.com"]);
  });

  void test("% matches only a percent sign", async () => {
    assert.deepStrictEqual(await emails("%%"), []);
    assert.deepStrictEqual(await emails("100%"), ["pct@example.com"]);
  });
});

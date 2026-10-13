import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const preload = path.resolve(__dirname, "helpers/db-lifecycle/preload.ts");
const scenarioFile = path.resolve(__dirname, "helpers/db-lifecycle/scenario.ts");

function withDatabase(run: (database: string, directory: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mulm-db-init-"));
  try {
    run(path.join(directory, "database.sqlite"), directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function child(file: string, database: string, scenario = "", args: string[] = []) {
  return execFileSync(process.execPath, ["--import", "tsx", "--import", preload, file, ...args], {
    cwd: path.resolve(__dirname, "../.."),
    env: {
      ...process.env,
      NODE_ENV: file === "src/index.ts" ? "development" : "test",
      TEST_DATABASE_FILE: database,
      DB_SCENARIO: scenario,
    },
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30_000,
  });
}

for (const scenario of [
  "imports",
  "override",
  "success",
  "migration-failure",
  "write-open-failure",
  "read-only",
  "read-only-missing",
]) {
  void test(`database lifecycle: ${scenario}`, () => {
    withDatabase((database) => {
      assert.match(child(scenarioFile, database, scenario), /DB_SCENARIO_COMPLETE/);
    });
  });
}

for (const script of [
  "scripts/sync-iucn-data.ts",
  "scripts/import-cares-iucn-data.ts",
  "scripts/merge-members.ts",
  "scripts/sweep-member-levels.ts",
  "scripts/check-r2-usage.ts",
  "scripts/createTestStatusData.ts",
  "src/scripts/email-rewitness.ts",
]) {
  void test(`${script} --help does not create a database`, () => {
    withDatabase((database) => {
      assert.ok(child(script, database, "", ["--help"]).length > 0);
      assert.equal(existsSync(database), false);
      assert.deepEqual(JSON.parse(readFileSync(`${database}.observed.json`, "utf8")), {
        opens: 0,
        migrations: 0,
      });
    });
  });
}

for (const failure of ["migration-failure", "admin-open-failure"]) {
  void test(`Portal refuses to listen on ${failure}`, () => {
    withDatabase((database) => {
      assert.throws(
        () => child("src/index.ts", database, failure),
        (error: unknown) => {
          assert.ok(
            error instanceof Error && "status" in error && "stdout" in error && "stderr" in error
          );
          assert.equal(error.status, 1);
          assert.match(String(error.stderr), /Failed to start server/);
          assert.doesNotMatch(String(error.stdout), /Server running at/);
          return true;
        }
      );
    });
  });
}

void test("CARES import dry run reads the existing database without migrating or changing it", () => {
  withDatabase((database, directory) => {
    child(scenarioFile, database, "success");
    const csv = path.join(directory, "species.csv");
    writeFileSync(csv, "scientific_name,classification\nTestus fishus,EN\n");
    const before = readFileSync(database);
    const output = child("scripts/import-cares-iucn-data.ts", database, "", [
      "--dry-run",
      "--csv-file",
      csv,
    ]);
    assert.match(output, /Dry Run: YES/);
    assert.deepEqual(readFileSync(database), before);
    assert.deepEqual(JSON.parse(readFileSync(`${database}.observed.json`, "utf8")), {
      opens: 1,
      migrations: 0,
    });
  });
});

for (const script of ["scripts/import-cares-iucn-data.ts", "scripts/sync-iucn-data.ts"]) {
  void test(`${script} dry run fails without creating a missing database`, () => {
    withDatabase((database, directory) => {
      const csv = path.join(directory, "species.csv");
      writeFileSync(csv, "scientific_name,classification\nTestus fishus,EN\n");
      assert.throws(
        () => child(script, database, "", ["--dry-run", "--csv-file", csv]),
        /SQLITE_CANTOPEN/
      );
      assert.equal(existsSync(database), false);
      assert.deepEqual(JSON.parse(readFileSync(`${database}.observed.json`, "utf8")), {
        opens: 1,
        migrations: 0,
      });
    });
  });
}

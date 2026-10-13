import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import config from "../../src/config.json";

/** Refuse implicit/default paths: only the run directory created by global setup. */
export function e2eDatabaseFile(): string {
  const file = process.env.MULM_E2E_DATABASE;
  const token = process.env.MULM_E2E_RUN;
  if (
    !file ||
    !token ||
    readFileSync(join(dirname(file), "owner"), "utf8") !== token ||
    resolve(file) !== join(dirname(file), "database.db")
  ) {
    throw new Error("E2E database must be allocated by Playwright global setup");
  }
  return file;
}

export function configureE2EDatabase(): void {
  config.database.file = e2eDatabaseFile();
}

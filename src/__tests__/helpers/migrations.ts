import fs from "fs";
import os from "os";
import path from "path";

export const allMigrations = "./db/migrations";

/** Internal to the database factory: a temporary inclusive migration cutoff. */
export function migrationsUpTo(lastId: number): string {
  if (!Number.isInteger(lastId) || lastId < 0) {
    throw new Error("Migration cutoff must be a non-negative integer");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mulm-migrations-"));
  try {
    for (const file of fs.readdirSync(allMigrations)) {
      const id = Number(/^(\d+)/.exec(file)?.[1]);
      if (file.endsWith(".sql") && id <= lastId) {
        fs.symlinkSync(path.resolve(allMigrations, file), path.join(dir, file));
      }
    }
    return dir;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
